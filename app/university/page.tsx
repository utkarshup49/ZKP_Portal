import { promises as fs } from "fs";
import path from "path";

import { UniversityPortal } from "@/components/UniversityPortal";

// The sample roster is read on the server and handed to the client component,
// so the "Load sample data" button needs no extra API route.
export const dynamic = "force-dynamic";

export default async function UniversityPage() {
  let sampleCsv = "";
  try {
    sampleCsv = await fs.readFile(
      path.join(process.cwd(), "data", "sample-students.csv"),
      "utf8",
    );
  } catch {
    sampleCsv = "";
  }

  return <UniversityPortal sampleCsv={sampleCsv} />;
}
