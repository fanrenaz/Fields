import type { CompanyReader } from "../../application/company/ports/company-reader.js";
import { companyRepository } from "../../infrastructure/persistence/postgres/repositories/company/company-repository.js";

export type CompositionCompanyReader = CompanyReader;

export const wireCompanyReader: CompanyReader = companyRepository;
