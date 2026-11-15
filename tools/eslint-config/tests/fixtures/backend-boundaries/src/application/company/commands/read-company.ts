import type { CompanyReader } from "../ports/company-reader.js";

export async function readCompany(reader: CompanyReader, id: string): Promise<boolean> {
  return (await reader.find(id)) !== undefined;
}
