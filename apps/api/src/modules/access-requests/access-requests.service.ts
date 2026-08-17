import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessRequestStatus } from '../../generated/prisma/enums';
import type { AccessRequestModel } from '../../generated/prisma/models';
import { AppSlug } from './app-slug';

export type AccessRequestStatusWire = 'pending' | 'approved' | 'denied';

export type AccessRequestStatusResponse = {
  status: AccessRequestStatusWire;
  downloadUrl: string | null;
};

export type AccessRequestAdminResponse = {
  id: string;
  email: string;
  appSlug: string;
  status: AccessRequestStatusWire;
  downloadUrl: string | null;
  createdAt: string;
};

const STATUS_TO_WIRE: Record<AccessRequestStatus, AccessRequestStatusWire> = {
  [AccessRequestStatus.PENDING]: 'pending',
  [AccessRequestStatus.APPROVED]: 'approved',
  [AccessRequestStatus.DENIED]: 'denied',
};

@Injectable()
export class AccessRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  // Idempotent by design (AC: re-requesting the same email+app never
  // duplicates): the unique (email, appSlug) constraint is the source of
  // truth, this just reads-before-write instead of racing a create against it.
  async requestAccess(
    email: string,
    appSlug: AppSlug,
  ): Promise<AccessRequestStatusResponse> {
    const existing = await this.prisma.accessRequest.findUnique({
      where: { email_appSlug: { email, appSlug } },
    });
    const record =
      existing ??
      (await this.prisma.accessRequest.create({ data: { email, appSlug } }));
    return this.toStatusResponse(record);
  }

  async getStatus(
    email: string,
    appSlug: AppSlug,
  ): Promise<AccessRequestStatusResponse> {
    const record = await this.prisma.accessRequest.findUnique({
      where: { email_appSlug: { email, appSlug } },
    });
    if (!record) {
      throw new NotFoundException(
        'No access request found for that email and app',
      );
    }
    return this.toStatusResponse(record);
  }

  async findAll(): Promise<AccessRequestAdminResponse[]> {
    const records = await this.prisma.accessRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => this.toAdminResponse(record));
  }

  async approve(
    id: string,
    downloadUrl: string,
  ): Promise<AccessRequestAdminResponse> {
    const record = await this.prisma.accessRequest.update({
      where: { id },
      data: { status: AccessRequestStatus.APPROVED, downloadUrl },
    });
    return this.toAdminResponse(record);
  }

  async deny(id: string): Promise<AccessRequestAdminResponse> {
    const record = await this.prisma.accessRequest.update({
      where: { id },
      data: { status: AccessRequestStatus.DENIED, downloadUrl: null },
    });
    return this.toAdminResponse(record);
  }

  private toStatusResponse(
    record: Pick<AccessRequestModel, 'status' | 'downloadUrl'>,
  ): AccessRequestStatusResponse {
    return {
      status: STATUS_TO_WIRE[record.status],
      // Only surface the URL once actually approved, even if a stale value
      // were ever left on the row (e.g. a denied-then-reset request).
      downloadUrl:
        record.status === AccessRequestStatus.APPROVED
          ? record.downloadUrl
          : null,
    };
  }

  private toAdminResponse(
    record: AccessRequestModel,
  ): AccessRequestAdminResponse {
    return {
      id: record.id,
      email: record.email,
      appSlug: record.appSlug,
      status: STATUS_TO_WIRE[record.status],
      downloadUrl: record.downloadUrl,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
