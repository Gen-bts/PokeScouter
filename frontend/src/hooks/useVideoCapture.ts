import { useCallback, useEffect, useRef, useState } from "react";

export interface UseVideoCapture {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  devices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  startCapture: (deviceId: string, audioDeviceId?: string) => Promise<void>;
  stopCapture: () => void;
  captureFrame: (quality: number) => Promise<Blob | null>;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}

export function useVideoCapture(): UseVideoCapture {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  // デバイス列挙（マウント時）
  useEffect(() => {
    let cancelled = false;

    async function enumerate() {
      // getUserMedia を一度呼ばないとラベルが取れないブラウザがある
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch {
        // 権限拒否でも列挙自体は試みる
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) {
        setDevices(allDevices.filter((d) => d.kind === "videoinput"));
        setAudioDevices(allDevices.filter((d) => d.kind === "audioinput"));
      }
    }

    enumerate();
    return () => {
      cancelled = true;
    };
  }, []);

  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!video || !canvas || !ctx || video.paused || video.ended) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    animFrameRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const stopCapture = useCallback(() => {
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
  }, []);

  const startCapture = useCallback(
    async (deviceId: string, audioDeviceId?: string) => {
      stopCapture();

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

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctxRef.current = canvas.getContext("2d");

      drawLoop();
    },
    [stopCapture, drawLoop],
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

  return { videoRef, canvasRef, devices, audioDevices, startCapture, stopCapture, captureFrame, setVolume, setMuted };
}
