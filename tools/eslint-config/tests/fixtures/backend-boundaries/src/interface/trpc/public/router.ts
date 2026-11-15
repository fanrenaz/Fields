import type { CompanyReader } from "../../../application/company/ports/company-reader.js";

export const router: Pick<CompanyReader, "find"> = {
  async find() {
    return undefined;
  },
};
