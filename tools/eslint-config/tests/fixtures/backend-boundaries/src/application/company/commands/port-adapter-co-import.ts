import type { CompanyReader } from "../ports/company-reader.js";
import { companyRepository } from "../../../infrastructure/persistence/postgres/repositories/company/company-repository.js";

export const invalidPortAdapterCoImport: CompanyReader = companyRepository;
