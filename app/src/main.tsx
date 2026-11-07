import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { VIEW3D_HASH } from "./layout/view3dWindow";
import View3DWindow from "./View3DWindow";

// The separate 3D window loads the same page with its own hash
const Root = window.location.hash === VIEW3D_HASH ? View3DWindow : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
