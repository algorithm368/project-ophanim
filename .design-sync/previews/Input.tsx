import { Input } from "project-ophanim";

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <Input placeholder="Paste an IP, domain, or file hash" />
  </div>
);

export const WithValue = () => (
  <div style={{ maxWidth: 360 }}>
    <Input defaultValue="185.220.101.4" />
  </div>
);

export const States = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
    <Input placeholder="Enabled" />
    <Input placeholder="Disabled" disabled />
    <Input defaultValue="not-an-indicator" aria-invalid />
  </div>
);
