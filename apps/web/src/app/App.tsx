import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { Studio } from "@/features/studio/Studio";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/studio/:sessionId" element={<Studio />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
