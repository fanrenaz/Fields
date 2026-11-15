import type { CompanyModel } from "../../../domain/company/model.js";

export interface CompanyReader {
  find(id: string): Promise<CompanyModel | undefined>;
}
