import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Badge,
  Button,
} from "project-ophanim";

export const SourceFinding = () => (
  <Card style={{ maxWidth: 380 }}>
    <CardHeader>
      <CardTitle>AbuseIPDB</CardTitle>
      <CardDescription>Crowd-sourced IP abuse reports</CardDescription>
      <CardAction>
        <Badge variant="destructive">Malicious</Badge>
      </CardAction>
    </CardHeader>
    <CardContent>
      <p style={{ margin: 0 }}>
        185.220.101.4 was reported 1,204 times in the last 90 days. Confidence
        of abuse is 100%. Categories include SSH brute force and port scanning.
      </p>
    </CardContent>
    <CardFooter>
      <Button variant="outline" size="sm">
        View report
      </Button>
    </CardFooter>
  </Card>
);

export const Compact = () => (
  <Card size="sm" style={{ maxWidth: 320 }}>
    <CardHeader>
      <CardTitle>Feodo Tracker</CardTitle>
      <CardDescription>Botnet command and control blocklist</CardDescription>
    </CardHeader>
    <CardContent>No active C2 listing for this indicator.</CardContent>
  </Card>
);
