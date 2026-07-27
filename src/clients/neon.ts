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

export async function findDealsWithRenewalDueToday(): Promise<DueRenewalDeal[]> {
  // line_items is a per-cycle log (a deal can have many rows, one per past
  // due date), so "due today" must compare against each deal's latest cycle,
  // not any row that happens to equal today.
  const result = await getPool().query<{ record_id: string; deal_name: string | null }>(
    `SELECT record_id, deal_name
     FROM line_items
     WHERE pipeline = $1
       AND deleted IS NULL
     GROUP BY record_id, deal_name
     HAVING MAX(due_on) = CURRENT_DATE`,
    [VA_PIPELINE_ID],
  );

  return result.rows.map((row) => ({
    dealId: row.record_id,
    dealName: row.deal_name ?? "",
  }));
}
