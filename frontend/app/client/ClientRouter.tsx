import { useEffect } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router";

import { MobileApp } from "../../mobile/MobileApp";
import { currentPhoneClient } from "../../shared/platform/device-class";
export function ClientRouter() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/*" element={<MobileClientGuard />} />
      </Routes>
    </BrowserRouter>
  );
}

function MobileClientGuard() {
  const phone = currentPhoneClient();
  usePwaRegistration(phone);
  return phone ? <MobileApp /> : <LeavePwa />;
}

function LeavePwa() {
  useEffect(() => { window.location.replace("/"); }, []);
  return null;
}

function usePwaRegistration(active: boolean): void {
  useEffect(() => {
    if (!active || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
  }, [active]);
}
