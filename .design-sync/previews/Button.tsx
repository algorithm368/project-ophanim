import { Button } from "project-ophanim";

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

export const Variants = () => (
  <div style={row}>
    <Button>Run check</Button>
    <Button variant="secondary">Copy IOC</Button>
    <Button variant="outline">Export JSON</Button>
    <Button variant="ghost">View raw</Button>
    <Button variant="destructive">Block indicator</Button>
    <Button variant="link">Open source</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button size="xs">Extra small</Button>
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const States = () => (
  <div style={row}>
    <Button>Enabled</Button>
    <Button disabled>Disabled</Button>
  </div>
);
