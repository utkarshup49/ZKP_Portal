import { promises as fs } from "fs";
import path from "path";

import { StudentPortal } from "@/components/StudentPortal";

// The sample roster backs the "Load demo student" shortcut only. A real wallet
// has no such file — the student imports the bundle their university issued.
export const dynamic = "force-dynamic";

export default async function StudentPage() {
  let sampleCsv = "";
  try {
    sampleCsv = await fs.readFile(
      path.join(process.cwd(), "data", "sample-students.csv"),
      "utf8",
    );
  } catch {
    sampleCsv = "";
  }

  return <StudentPortal sampleCsv={sampleCsv} />;
}
