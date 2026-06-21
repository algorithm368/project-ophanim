import { Badge } from "project-ophanim";

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

export const Variants = () => (
  <div style={row}>
    <Badge>Default</Badge>
    <Badge variant="secondary">Secondary</Badge>
    <Badge variant="destructive">Destructive</Badge>
    <Badge variant="outline">Outline</Badge>
    <Badge variant="ghost">Ghost</Badge>
    <Badge variant="link">Link</Badge>
  </div>
);

export const Verdicts = () => (
  <div style={row}>
    <Badge variant="destructive">Malicious</Badge>
    <Badge variant="secondary">Suspicious</Badge>
    <Badge variant="outline">Clean</Badge>
    <Badge variant="ghost">Unknown</Badge>
  </div>
);

export const Categories = () => (
  <div style={row}>
    <Badge variant="outline">C2</Badge>
    <Badge variant="outline">Phishing</Badge>
    <Badge variant="outline">Botnet</Badge>
    <Badge variant="secondary">AbuseIPDB</Badge>
    <Badge variant="secondary">Feodo Tracker</Badge>
  </div>
);
