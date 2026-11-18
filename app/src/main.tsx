import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { VIEW3D_HASH } from "./layout/view3dWindow";
import { runPerfIfAsked } from "./perf";
import View3DWindow from "./View3DWindow";

// The separate 3D window loads the same page with its own hash
const Root = window.location.hash === VIEW3D_HASH ? View3DWindow : App;

// A performance run, when the app was started for one (scripts/perf.ps1)
if (Root === App) void runPerfIfAsked();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
