"use client";

import { useRef, useState } from "react";

export function ImageUpload({ imageKey, onChange }: { imageKey: string | null; onChange: (key: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/media", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload failed.");
      onChange(data.key);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return <div className="image-upload">
    <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} />
    {imageKey ? <div className="image-preview"><img src={`/api/media/${encodeURIComponent(imageKey)}`} alt="Uploaded image" style={{maxWidth: "200px", maxHeight: "200px"}} /><button type="button" className="text-button" onClick={() => { onChange(null); if (inputRef.current) inputRef.current.value = ""; }}>Remove image</button></div> : <button type="button" className="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading..." : "Add image"}</button>}
    {message && <p className="field-help" style={{color: "#b54b31"}}>{message}</p>}
  </div>;
}