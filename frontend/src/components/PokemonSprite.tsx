import { memo, useEffect, useRef, useState } from "react";

/**
 * ポケモンスプライト画像を透過部分を除いて目一杯に表示するコンポーネント。
 *
 * Canvas で画像を読み込み、不透明ピクセルのバウンディングボックスを計測して
 * その領域だけをアスペクト比維持で拡大描画する。
 */
export const PokemonSprite = memo(function PokemonSprite({
  pokemonId,
  size = 48,
  className,
  placeholderClass,
}: {
  pokemonId: string | null;
  size?: number;
  className?: string;
  placeholderClass?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    setState("loading");
    if (pokemonId === null) {
      setState("error");
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // 不透明部分のバウンディングボックスを計測
      const tmp = document.createElement("canvas");
      tmp.width = img.width;
      tmp.height = img.height;
      const tmpCtx = tmp.getContext("2d")!;
      tmpCtx.drawImage(img, 0, 0);
      const data = tmpCtx.getImageData(0, 0, img.width, img.height).data;

      let minX = img.width;
      let minY = img.height;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if ((data[(y * img.width + x) * 4 + 3] ?? 0) > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX <= minX || maxY <= minY) {
        setState("error");
        return;
      }

      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;

      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;

      // アスペクト比を維持してフィット
      const scale = Math.min(size / cw, size / ch);
      const dw = cw * scale;
      const dh = ch * scale;
      ctx.drawImage(
        img,
        minX, minY, cw, ch,
        (size - dw) / 2, (size - dh) / 2, dw, dh,
      );
      setState("ok");
    };

    img.onerror = () => setState("error");
    img.src = `/sprites/${pokemonId}.png`;
  }, [pokemonId, size]);

  if (pokemonId === null || state === "error") {
    return (
      <div className={placeholderClass} style={{ width: size, height: size }}>
        ?
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
});
