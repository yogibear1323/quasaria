import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders `value` (e.g. a public address or referral link) as a QR code, entirely in the browser. */
export default function QrCode({ value, size = 168, label }: { value: string; size?: number; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b1530", light: "#f4f8ff" } })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => { alive = false; };
  }, [value, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={label ?? `QR code for ${value}`} data-testid="qr-code" style={{ borderRadius: 10, background: "#f4f8ff", padding: 6 }} /> : <div style={{ width: size, height: size }} className="muted" aria-hidden />;
}
