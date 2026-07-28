<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "DejaVu Sans", sans-serif;
    color: #0f172a; margin: 0; padding: 24px;
  }
  header { display: flex; justify-content: space-between; align-items: flex-end;
           border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 20px; font-weight: 700; color: #0f766e; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: #64748b; margin-top: 2px; }
  .meta { font-size: 11px; color: #64748b; text-align: left; }
  h1 { font-size: 16px; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { background: #f0fdfa; color: #134e4a; text-align: right; padding: 8px 10px;
             border-bottom: 2px solid #99f6e4; font-weight: 700; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .empty { text-align: center; color: #64748b; padding: 32px; }
  .num { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <header>
    <div class="brand">
      بحر المعاني
      <small>إدارة خدمات الترجمة</small>
    </div>
    <div class="meta">
      @if(!empty($params['from']) || !empty($params['to']))
        الفترة: {{ $params['from'] ?? '—' }} إلى {{ $params['to'] ?? '—' }}<br>
      @endif
      أُنشئ في {{ $generatedAt->isoFormat('YYYY/MM/DD HH:mm') }}
    </div>
  </header>

  <h1>{{ $title }}</h1>

  @if($rows->isEmpty())
    <p class="empty">لا توجد بيانات ضمن هذه الفترة.</p>
  @else
    <table>
      <thead>
        <tr>
          @foreach($columns as $label)
            <th>{{ $label }}</th>
          @endforeach
        </tr>
      </thead>
      <tbody>
        @foreach($rows as $row)
          <tr>
            @foreach(array_keys($columns) as $key)
              <td class="{{ is_numeric($row[$key] ?? null) ? 'num' : '' }}">
                {{ $row[$key] ?? '—' }}
              </td>
            @endforeach
          </tr>
        @endforeach
      </tbody>
    </table>
  @endif
</body>
</html>
