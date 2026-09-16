import { BadRequestException, Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { GetBalanceUseCase } from '../application/get-balance.usecase';
import { DailyBalance } from '../domain/daily-balance';
import { JwtAuthGuard, Principal, RequireScope } from '../shared/auth.guard';

const toResponse = (b: DailyBalance) => ({
  date: b.date,
  totalCreditsCents: b.totalCreditsCents,
  totalDebitsCents: b.totalDebitsCents,
  balanceCents: b.balanceCents,
  entryCount: b.entryCount,
  updatedAt: b.updatedAt?.toISOString() ?? null,
});

@Controller('v1/balance')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(private readonly getBalance: GetBalanceUseCase) {}

  /**
   * GET /v1/balance/daily?date=2026-09-16
   * GET /v1/balance/daily?from=2026-09-01&to=2026-09-16
   * Eventually consistent: typically less than a second behind the entries.
   */
  @Get('daily')
  @RequireScope('balance:read')
  @Header('Cache-Control', 'private, max-age=5')
  async daily(
    @Req() req: { principal: Principal },
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const start = date ?? from;
    const end = date ?? to ?? from;
    if (!start || !end) {
      throw new BadRequestException('Provide "date" or the "from"/"to" range (YYYY-MM-DD)');
    }
    const r = await this.getBalance.execute(req.principal.merchantId, start, end);
    return {
      from: r.from,
      to: r.to,
      currency: 'BRL',
      days: r.days.map(toResponse),
      totals: r.totals,
    };
  }
}
