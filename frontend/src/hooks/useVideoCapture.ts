import { useCallback, useEffect, useRef, useState } from "react";

export interface UseVideoCapture {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  devices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  devicesReady: boolean;
  isCapturing: boolean;
  startCapture: (deviceId: string, audioDeviceId?: string) => Promise<void>;
  stopCapture: () => void;
  captureFrame: (quality: number) => Promise<Blob | null>;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  refreshDevices: () => Promise<void>;
}

export function useVideoCapture(): UseVideoCapture {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const captureRequestIdRef = useRef(0);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesReady, setDevicesReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const enumerateDevices = useCallback(async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    if (!mountedRef.current) return;
    setDevices(allDevices.filter((d) => d.kind === "videoinput"));
    setAudioDevices(allDevices.filter((d) => d.kind === "audioinput"));
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      tempStream.getTracks().forEach((t) => t.stop());
    } catch {
      // 権限拒否でも列挙自体は試みる
    }
    await enumerateDevices();
    if (mountedRef.current) {
      setDevicesReady(true);
    }
  }, [enumerateDevices]);

  // 初回マウント時の列挙 + devicechange リスナー
  useEffect(() => {
    mountedRef.current = true;
    refreshDevices();

    const handleDeviceChange = () => {
      enumerateDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      mountedRef.current = false;
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshDevices, enumerateDevices]);

  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!video || !canvas || !ctx || video.paused || video.ended) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    animFrameRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const waitForVideoDimensions = useCallback(
    async (video: HTMLVideoElement, stream: MediaStream) => {
      const trackSettings = stream.getVideoTracks()[0]?.getSettings();
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        return { width: video.videoWidth, height: video.videoHeight };
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        let timeoutId: number | null = null;
        const cleanup = () => {
          video.removeEventListener("loadedmetadata", handleReady);
          video.removeEventListener("resize", handleReady);
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const handleReady = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            finish();
          }
        };

        video.addEventListener("loadedmetadata", handleReady);
        video.addEventListener("resize", handleReady);
        timeoutId = window.setTimeout(finish, 1500);
        handleReady();
      });

      const width = video.videoWidth || trackSettings?.width || 1920;
      const height = video.videoHeight || trackSettings?.height || 1080;
      return { width, height };
    },
    [],
  );

  const stopCapture = useCallback(() => {
    captureRequestIdRef.current += 1;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  }, []);

  const startCapture = useCallback(
    async (deviceId: string, audioDeviceId?: string) => {
      stopCapture();
      const requestId = captureRequestIdRef.current;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: {
          ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      if (captureRequestIdRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      const { width, height } = await waitForVideoDimensions(video, stream);

      if (captureRequestIdRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      canvas.width = width;
      canvas.height = height;
      ctxRef.current = canvas.getContext("2d");

      setIsCapturing(true);
      drawLoop();

      await enumerateDevices();
    },
    [stopCapture, waitForVideoDimensions, drawLoop, enumerateDevices],
  );

  const setVolume = useCallback((v: number) => {
    if (videoRef.current) {
      videoRef.current.volume = v;
    }
  }, []);

  const setMuted = useCallback((m: boolean) => {
    if (videoRef.current) {
      videoRef.current.muted = m;
    }
  }, []);

  const captureFrame = useCallback(
    async (quality: number): Promise<Blob | null> => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
      });
    },
    [],
  );

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    devices,
    audioDevices,
    devicesReady,
    isCapturing,
    startCapture,
    stopCapture,
    captureFrame,
    setVolume,
    setMuted,
    refreshDevices,
  };
}
