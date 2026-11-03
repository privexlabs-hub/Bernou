import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { Studio } from "@/features/studio/Studio";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/studio/:sessionId" element={<StudioRoute />} />
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
