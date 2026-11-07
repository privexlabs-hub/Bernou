import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { recoverInterruptedRecordings } from "@/features/recording/recordingController";
import { Studio } from "@/features/studio/Studio";

// Its own chunk: the editor and its media libraries load only when it's opened.
const EditorPage = lazy(() => import("@/features/editor/EditorPage").then((m) => ({ default: m.EditorPage })));

export function App() {
  useEffect(() => void recoverInterruptedRecordings().catch(() => undefined), []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/studio/:sessionId" element={<StudioRoute />} />
        <Route
          path="/recordings/:id/edit"
          element={
            <Suspense fallback={<main className="flex h-full items-center justify-center text-sm text-muted-foreground">Opening the editor…</main>}>
              <EditorPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/** One Studio instance per session, so leaving one always runs its cleanup. */
function StudioRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <Studio key={sessionId} />;
}
