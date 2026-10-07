import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { finalize } from 'rxjs';
import {
  BusinessDashboardSummary,
  DashboardPeriod,
  DashboardSummaryQuery,
  TopOrderedProduct,
} from './shared/master-data.types';
import { WorkOrderService } from './work-order/work-order.service';

export interface ChartPoint {
  label: string;
  enquiries: number;
  workOrders: number;
  collectedAmount: number;
}

export interface SvgChartData {
  viewBox: string;
  width: number;
  height: number;
  paddingLeft: number;
  paddingBottom: number;
  paddingTop: number;
  paddingRight: number;
  plotWidth: number;
  plotHeight: number;
  yMax: number;
  yTicks: number[];
  xLabels: string[];
  enquiriesPath: string;
  workOrdersPath: string;
  enquiriesPoints: Array<{ x: number; y: number; value: number }>;
  workOrdersPoints: Array<{ x: number; y: number; value: number }>;
  collectedBars: Array<{ x: number; y: number; width: number; height: number; value: number; label: string }>;
}

@Component({
  selector: 'app-business-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './business-dashboard.component.html',
  styleUrl: './business-dashboard.component.css',
})
export class BusinessDashboardComponent implements OnInit {
  loading = false;
  errorMessage = '';
  selectedPeriod: DashboardPeriod = 'month';
  customFrom = '';
  customTo = '';
  activeTooltip: { x: number; y: number; lines: string[] } | null = null;

  dashboardSummary: BusinessDashboardSummary = {
    range: { period: 'month', from: '', to: '' },
    businessSummary: {
      customerEnquiries: 0, workOrders: 0, quotes: 0,
      invoices: 0, payments: 0, grossSales: 0, collectedAmount: 0,
    },
    salesPipeline: {
      enquiries: 0, workOrders: 0, quotes: 0, invoices: 0, payments: 0,
    },
    quoteOverview: {
      totalQuotes: 0, draftQuotes: 0, sentQuotes: 0, acceptedQuotes: 0,
      declinedQuotes: 0, expiredQuotes: 0, totalQuoteValue: 0,
    },
    invoiceOverview: {
      totalInvoices: 0, draftInvoices: 0, sentInvoices: 0, partiallyPaidInvoices: 0,
      paidInvoices: 0, overdueInvoices: 0, voidInvoices: 0, totalInvoiceValue: 0,
    },
    paymentOverview: {
      paidInvoicesOrOrders: 0, pendingInvoicesOrOrders: 0, totalPayments: 0,
      pendingPayments: 0, successPayments: 0, failedPayments: 0, refundedPayments: 0,
      totalPaymentAmount: 0, collectedAmount: 0, outstandingAmount: 0,
    },
    orderInsights: {
      totalItemQuantitySold: 0, averageOrderValue: 0, highestOrderValue: 0, topOrderedProducts: [],
    },
    enquiryConversion: {
      enquiriesReceived: 0, workOrdersCreated: 0, conversionRate: 0, pendingEnquiries: 0,
    },
    funnelConversion: {
      enquiryToWorkOrderRate: 0, workOrderToQuoteRate: 0,
      quoteToInvoiceRate: 0, invoiceToPaidRate: 0,
    },
    recentActivity: { enquiries: [], quotes: [], invoices: [], payments: [] },
    trend: { granularity: 'day', points: [] },
  };

  constructor(
    private readonly workOrderService: WorkOrderService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadSummary();
  }

  // ── Data accessors ─────────────────────────────────────────────────────────

  get topOrderedProducts(): TopOrderedProduct[] {
    return this.dashboardSummary.orderInsights.topOrderedProducts;
  }

  get productChartMax(): number {
    return Math.max(1, ...this.topOrderedProducts.map((p) => p.quantity));
  }

  // ── Funnel stages — merged from funnelConversion + enquiryConversion ───────

  get funnelStages(): Array<{ label: string; rate: string; value: string; color: string }> {
    const fc = this.dashboardSummary.funnelConversion;
    const ec = this.dashboardSummary.enquiryConversion;
    return [
      { label: 'Enquiry → Work Order', rate: this.formatRate(fc.enquiryToWorkOrderRate), value: `${this.formatMetric(ec.enquiriesReceived)} enquiries`, color: '#0f766e' },
      { label: 'Quote → Invoice',      rate: this.formatRate(fc.quoteToInvoiceRate),      value: `${this.formatMetric(ec.pendingEnquiries)} pending`,   color: '#7c3aed' },
      { label: 'Invoice → Paid',       rate: this.formatRate(fc.invoiceToPaidRate),       value: `Overall conv. ${this.formatRate(ec.conversionRate)}`, color: '#f59e0b' },
    ];
  }

  // ── SVG Trend Chart ────────────────────────────────────────────────────────

  get svgChart(): SvgChartData | null {
    const points = this.dashboardSummary.trend.points;
    if (!points.length) return null;

    const W = 900, H = 300;
    const PL = 58, PR = 16, PT = 16, PB = 36;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    // y-axis: cover enquiries/workOrders (left axis)
    const rawMax = Math.max(1, ...points.flatMap((p) => [p.enquiries, p.workOrders]));
    const yMax = this.niceMax(rawMax);
    const yTicks = this.makeTicks(yMax, 5);

    // x positions
    const xStep = points.length > 1 ? plotW / (points.length - 1) : plotW;
    const xPos = (i: number) => PL + (points.length > 1 ? i * xStep : plotW / 2);
    const yPos = (v: number) => PT + plotH - (v / yMax) * plotH;

    const toPath = (vals: number[]) =>
      vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');

    // collected amount bars
    const barW = Math.max(4, Math.min(24, xStep * 0.35));
    const amtMax = Math.max(1, ...points.map((p) => p.collectedAmount));
    const collectedBars = points.map((p, i) => {
      const bh = (p.collectedAmount / amtMax) * plotH;
      return {
        x: xPos(i) - barW / 2,
        y: PT + plotH - bh,
        width: barW,
        height: Math.max(2, bh),
        value: p.collectedAmount,
        label: p.label,
      };
    });

    return {
      viewBox: `0 0 ${W} ${H}`,
      width: W, height: H,
      paddingLeft: PL, paddingBottom: PB, paddingTop: PT, paddingRight: PR,
      plotWidth: plotW, plotHeight: plotH,
      yMax, yTicks,
      xLabels: points.map((p) => p.label),
      enquiriesPath: toPath(points.map((p) => p.enquiries)),
      workOrdersPath: toPath(points.map((p) => p.workOrders)),
      enquiriesPoints: points.map((p, i) => ({ x: xPos(i), y: yPos(p.enquiries), value: p.enquiries })),
      workOrdersPoints: points.map((p, i) => ({ x: xPos(i), y: yPos(p.workOrders), value: p.workOrders })),
      collectedBars,
    };
  }

  showTooltip(event: MouseEvent, lines: string[]): void {
    const rect = (event.currentTarget as SVGElement).closest('svg')?.getBoundingClientRect();
    const svgRect = (event.currentTarget as SVGElement).getBoundingClientRect();
    if (!rect) return;
    this.activeTooltip = {
      x: svgRect.left - rect.left + svgRect.width / 2,
      y: svgRect.top - rect.top - 8,
      lines,
    };
    this.changeDetectorRef.detectChanges();
  }

  hideTooltip(): void {
    this.activeTooltip = null;
    this.changeDetectorRef.detectChanges();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  loadSummary(query: DashboardSummaryQuery = {}): void {
    this.loading = true;
    this.errorMessage = '';

    this.workOrderService.getBusinessDashboardSummary(query)
      .pipe(finalize(() => { this.loading = false; this.changeDetectorRef.detectChanges(); }))
      .subscribe({
        next: (response) => {
          this.dashboardSummary = response?.data ?? this.dashboardSummary;
          this.selectedPeriod = this.dashboardSummary.range.period;
          this.customFrom = this.dashboardSummary.range.from?.slice(0, 10) ?? this.customFrom;
          this.customTo = this.dashboardSummary.range.to?.slice(0, 10) ?? this.customTo;
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to load dashboard summary.';
        },
      });
  }

  setPeriod(period: DashboardPeriod): void {
    this.selectedPeriod = period;
    if (period === 'custom') {
      if (this.customFrom && this.customTo) this.applyCustomRange();
      return;
    }
    this.loadSummary({ period });
  }

  applyCustomRange(): void {
    if (!this.customFrom || !this.customTo) {
      this.errorMessage = 'Choose both from and to dates for custom range.';
      this.changeDetectorRef.detectChanges();
      return;
    }
    this.selectedPeriod = 'custom';
    this.loadSummary({ period: 'custom', from: this.customFrom, to: this.customTo });
  }

  refreshSummary(): void {
    if (this.selectedPeriod === 'custom') { this.applyCustomRange(); return; }
    this.loadSummary({ period: this.selectedPeriod });
  }

  // ── Formatters ─────────────────────────────────────────────────────────────

  getRangeLabel(): string {
    if (!this.dashboardSummary.range.from || !this.dashboardSummary.range.to) return '';
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${fmt(this.dashboardSummary.range.from)} to ${fmt(this.dashboardSummary.range.to)}`;
  }

  formatCurrency(value: number | null | undefined): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  formatMetric(value: number | null | undefined): string {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  formatRate(value: number | null | undefined): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  formatStatusLabel(value: string | null | undefined): string {
    return String(value || '').replace(/_/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ── SVG helpers ────────────────────────────────────────────────────────────

  private niceMax(raw: number): number {
    if (raw <= 0) return 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / magnitude;
    const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return niceFactor * magnitude;
  }

  private makeTicks(max: number, count: number): number[] {
    const step = max / count;
    return Array.from({ length: count + 1 }, (_, i) => i * step);
  }
}
