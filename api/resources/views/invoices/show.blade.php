<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "DejaVu Sans", sans-serif;
    color: #0f172a; margin: 0; padding: 28px;
  }
  header { display: flex; justify-content: space-between; align-items: flex-end;
           border-bottom: 3px solid #152341; padding-bottom: 14px; margin-bottom: 20px; }
  .brand { font-size: 22px; font-weight: 700; color: #152341; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: #64748b; margin-top: 2px; }
  .doc { text-align: left; }
  .doc .kind { font-size: 18px; font-weight: 700; color: #152341; }
  .doc .num { font-size: 13px; color: #334155; font-variant-numeric: tabular-nums; direction: ltr; }
  .doc .date { font-size: 11px; color: #64748b; margin-top: 2px; }
  .client { display: flex; gap: 24px; margin-bottom: 18px; font-size: 13px; }
  .client .label { color: #64748b; font-size: 11px; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { background: #f1f5f9; color: #152341; text-align: right; padding: 8px 10px;
             border-bottom: 2px solid #cbd5e1; font-weight: 700; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .num { font-variant-numeric: tabular-nums; }
  tfoot td { padding: 8px 10px; font-weight: 700; }
  .totals { margin-top: 18px; margin-inline-start: auto; width: 55%; font-size: 13px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 10px;
                 border-bottom: 1px solid #e2e8f0; }
  .totals .grand { background: #152341; color: #fff; font-weight: 700; font-size: 15px;
                   border-radius: 6px; margin-top: 6px; border: none; }
  .totals .grand .amount { direction: ltr; }
  .notes { margin-top: 20px; font-size: 12px; color: #334155; background: #f8fafc;
           border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0;
           font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <header>
    <div class="brand">
      بحر المعاني
      <small>إدارة خدمات الترجمة</small>
    </div>
    <div class="doc">
      <div class="kind">فاتورة</div>
      <div class="num">{{ $invoice->number }}</div>
      <div class="date">التاريخ: {{ $invoice->issued_at->isoFormat('YYYY/MM/DD') }}</div>
    </div>
  </header>

  <div class="client">
    <div>
      <div class="label">العميل</div>
      <strong>{{ $invoice->client->name }}</strong>
    </div>
    @if($invoice->client->phone)
      <div>
        <div class="label">الهاتف</div>
        <span dir="ltr">{{ $invoice->client->phone }}</span>
      </div>
    @endif
    @if($invoice->client->email)
      <div>
        <div class="label">البريد الإلكتروني</div>
        <span dir="ltr">{{ $invoice->client->email }}</span>
      </div>
    @endif
  </div>

  <table>
    <thead>
      <tr>
        <th>الكود</th>
        <th>المشروع</th>
        <th>الصفحات</th>
      </tr>
    </thead>
    <tbody>
      @foreach($invoice->line_items as $line)
        <tr>
          <td class="num" dir="ltr" style="text-align: right;">{{ $line['code'] }}</td>
          <td>{{ $line['title'] }}</td>
          <td class="num">{{ $line['pages'] ?? '—' }}</td>
        </tr>
      @endforeach
    </tbody>
  </table>

  <div class="totals">
    <div class="row">
      <span>إجمالي الصفحات</span>
      <span class="num">{{ number_format($invoice->total_pages) }}</span>
    </div>
    @if($invoice->unit_price !== null)
      <div class="row">
        <span>سعر الصفحة</span>
        <span class="num">{{ number_format((float) $invoice->unit_price, 2) }} {{ $invoice->currency }}</span>
      </div>
    @endif
    <div class="row grand">
      <span>الإجمالي المستحق</span>
      <span class="amount num">{{ number_format((float) $invoice->amount, 2) }} {{ $invoice->currency }}</span>
    </div>
  </div>

  @if($invoice->notes)
    <div class="notes">{{ $invoice->notes }}</div>
  @endif

  <footer>
    شكراً لتعاملكم مع بحر المعاني — هذه الفاتورة صادرة إلكترونياً من نظام إدارة خدمات الترجمة.
  </footer>
</body>
</html>
