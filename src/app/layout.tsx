import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "FormForge", description: "Assessment authoring and print generation" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
