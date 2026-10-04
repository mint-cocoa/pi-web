import { Suspense } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { DotWorkspace } from "@/components/dot/DotWorkspace";
import "./dot.css";

export default function DotPage() {
  return <Suspense><I18nProvider><DotWorkspace /></I18nProvider></Suspense>;
}
