export function QuestionImage({ imageKey }: { imageKey: string | null | undefined }) {
  if (!imageKey) return null;
  return <img src={`/api/media/${encodeURIComponent(imageKey)}`} alt="" style={{maxWidth: "100%", maxHeight: "180px", marginTop: "8px", borderRadius: "4px"}} />;
}