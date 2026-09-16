import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ListEntriesUseCase } from '../application/list-entries.usecase';
import { RecordEntryUseCase } from '../application/record-entry.usecase';
import { Entry } from '../domain/entry';
import { JwtAuthGuard, Principal, RequireScope } from '../shared/auth.guard';

interface CreateEntryBody {
  type?: unknown;
  amountCents?: unknown;
  description?: unknown;
  entryDate?: unknown;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

function toResponse(e: Entry) {
  return {
    id: e.id,
    type: e.type,
    amountCents: e.amountCents,
    description: e.description,
    entryDate: e.entryDate,
    createdAt: e.createdAt.toISOString(),
  };
}

@Controller('v1/entries')
@UseGuards(JwtAuthGuard)
export class EntriesController {
  constructor(
    private readonly recordEntry: RecordEntryUseCase,
    private readonly listEntries: ListEntriesUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireScope('entries:write')
  async create(
    @Req() req: { principal: Principal },
    @Body() body: CreateEntryBody,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
      throw new BadRequestException('Invalid Idempotency-Key (8-64 chars, alphanumeric, _ or -)');
    }
    // Shape validation only; business rules live in the domain.
    if (typeof body?.type !== 'string' || typeof body?.amountCents !== 'number') {
      throw new BadRequestException('Required fields: type (string) and amountCents (integer)');
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
      throw new BadRequestException('description must be a string');
    }
    if (body.entryDate !== undefined && typeof body.entryDate !== 'string') {
      throw new BadRequestException('entryDate must be a YYYY-MM-DD string');
    }

    const { entry, created } = await this.recordEntry.execute({
      merchantId: req.principal.merchantId,
      type: body.type,
      amountCents: body.amountCents,
      description: body.description as string | undefined,
      entryDate: body.entryDate as string | undefined,
      idempotencyKey: key,
    });
    if (!created) {
      res.status(200);
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.setHeader('Location', `/v1/entries/${entry.id}`);
    return toResponse(entry);
  }

  @Get()
  @RequireScope('entries:read')
  async list(
    @Req() req: { principal: Principal },
    @Query('date') date: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (!date) throw new BadRequestException('Query parameter date (YYYY-MM-DD) is required');
    const r = await this.listEntries.byDate(req.principal.merchantId, date, Number(limit ?? 50) || 50, cursor);
    return { items: r.items.map(toResponse), nextCursor: r.nextCursor };
  }

  @Get(':id')
  @RequireScope('entries:read')
  async get(@Req() req: { principal: Principal }, @Param('id') id: string) {
    const entry = await this.listEntries.byId(req.principal.merchantId, id);
    if (!entry) throw new NotFoundException('Entry not found');
    return toResponse(entry);
  }
}
