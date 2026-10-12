import { BadRequestException, Body, Controller, Inject, NotFoundException, Post, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import {
  AdminGuard,
  createEmployee,
  MIN_STAFF_PASSWORD_LENGTH,
  MIN_STAFF_USERNAME_LENGTH,
  nowLocalIso,
  updateEmployee,
} from "../../identity";

interface CreateEmployeeBody {
  username?: string;
  password?: string;
  display_name?: string;
  role?: string;
}

interface UpdateEmployeeBody {
  customer_id?: string;
  role?: string;
  status?: string;
  new_password?: string;
}

/** The use-case reasons, mapped to the status codes the old console returned. */
function toHttpError(reason: string): Error {
  switch (reason) {
    case "username_too_short":
      return new BadRequestException(`username must be at least ${MIN_STAFF_USERNAME_LENGTH} characters`);
    case "password_too_short":
      return new BadRequestException(`password must be at least ${MIN_STAFF_PASSWORD_LENGTH} characters`);
    case "username_taken":
      return new BadRequestException("that login already exists");
    case "not_found":
      return new NotFoundException("employee not found");
    case "root_admin_locked":
      return new BadRequestException("the root admin cannot be demoted or disabled");
    default:
      return new BadRequestException("invalid employee request");
  }
}

/**
 * Staff account management: create the people who sign into the console, and
 * change their role, status or password. Admin only. The write itself is
 * Identity's, because a staff account is a customer row.
 */
@Controller("api/admin/employees")
@UseGuards(AdminGuard)
export class AdminEmployeeController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post()
  create(@Body() body: CreateEmployeeBody) {
    const result = createEmployee(
      this.db,
      {
        username: body?.username ?? "",
        password: body?.password ?? "",
        displayName: body?.display_name,
        role: body?.role,
      },
      nowLocalIso(),
    );
    if (!result.ok) throw toHttpError(result.reason);
    return { ok: true, customerId: result.customerId, displayName: result.displayName, role: result.role };
  }

  @Post("update")
  update(@Body() body: UpdateEmployeeBody) {
    const customerId = (body?.customer_id ?? "").trim();
    if (customerId === "") throw new BadRequestException("customer_id is required");

    const result = updateEmployee(
      this.db,
      { customerId, role: body?.role, status: body?.status, newPassword: body?.new_password },
      nowLocalIso(),
    );
    if (!result.ok) throw toHttpError(result.reason);
    return { ok: true, updated: result.updated };
  }
}
