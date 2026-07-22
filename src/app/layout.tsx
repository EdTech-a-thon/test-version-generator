import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "Test Generator", description: "Assessment authoring and print generation" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
