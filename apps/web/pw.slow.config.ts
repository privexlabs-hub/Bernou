import base from "./playwright.config";
export default { ...base, timeout: 90_000, webServer: { ...(base.webServer as object), timeout: 500_000 } };
