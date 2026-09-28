import { Pool } from "pg";
import { config } from "../config.js";

const VA_PIPELINE_ID = "1534965463";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.neon.databaseUrl });
  }
  return pool;
}

export interface DueRenewalDeal {
  dealId: string;
  dealName: string;
}

// `istDate` is today's IST calendar date (YYYY-MM-DD) — Neon's own
// CURRENT_DATE would be evaluated in the database server's timezone.
//
// `windowDays` = 4 means due today or on any of the three days before, so
// one missed daily run does not lose the renewal.
export async function findDealsWithRenewalDue(istDate: string, windowDays: number): Promise<DueRenewalDeal[]> {
  // line_items is a per-cycle log (a deal can have many rows, one per past
  // due date), so "due today" must compare against each deal's latest cycle,
  // not any row that happens to equal today.
  const result = await getPool().query<{ record_id: string; deal_name: string | null }>(
    `SELECT record_id, deal_name
     FROM line_items
     WHERE pipeline = $1
       AND deleted IS NULL
     GROUP BY record_id, deal_name
     HAVING MAX(due_on) BETWEEN $2::date - $3::int AND $2::date`,
    [VA_PIPELINE_ID, istDate, windowDays - 1],
  );

  return result.rows.map((row) => ({
    dealId: row.record_id,
    dealName: row.deal_name ?? "",
  }));
}
