import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { MetaProvider } from "./lib/MetaContext";
import Dashboard from "./pages/Dashboard";
import Workbench from "./pages/Workbench";
import Blueprints from "./pages/Blueprints";
import Batch from "./pages/Batch";
import Ledger from "./pages/Ledger";
import Calibration from "./pages/Calibration";
import Methodology from "./pages/Methodology";

export default function App() {
  return (
    <MetaProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workbench" element={<Workbench />} />
          <Route path="/workbench/:bpId" element={<Workbench />} />
          <Route path="/blueprints" element={<Blueprints />} />
          {/* 本体链路已并入决策工作台 */}
          <Route path="/ontology" element={<Navigate to="/workbench" replace />} />
          <Route path="/batch" element={<Batch />} />
          <Route path="/batch/:bpId" element={<Batch />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/calibration" element={<Calibration />} />
          <Route path="/methodology" element={<Methodology />} />
        </Routes>
      </Layout>
    </MetaProvider>
  );
}
