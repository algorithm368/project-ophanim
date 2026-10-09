import { Suspense } from "react";
import { BulkLookup } from "@/components/Bulk/BulkLookup";

export const metadata = { title: "Bulk lookup" };

export default function BulkPage() {
  return (
    <Suspense>
      <BulkLookup />
    </Suspense>
  );
}
