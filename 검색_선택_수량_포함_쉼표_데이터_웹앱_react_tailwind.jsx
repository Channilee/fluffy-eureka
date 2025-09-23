import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

// =============================
// Part Selector Web App (Excel-only add, Category filter, KR space-insensitive search)
// - Upload .xlsx/.xls/.csv만으로 리스트 구성
// - 카테고리 파싱: 이름 앞의 [카테고리] 를 추출해 category 필드로 저장
// - 카테고리 버튼으로 필터링 + 한국어 검색(띄어쓰기/대소문자 무시)
// - 다중 선택 + 수량 (리스트에서 미리 수량 입력 가능, 수량 입력 시 자동 선택)
// - 출력: 이름x수량,이름  (수량이 1이면 x1 생략)
// - 출력 문자열은 공백(스페이스/개행) 완전히 제거
// =============================

// 샘플 부품 리스트 (업로드 전 테스트용) — 카테고리 포함 표기
const SAMPLE_PARTS_RAW = [
  { id: "p1", name: "[동물] 강아지" },
  { id: "p2", name: "[동물] 고양이" },
  { id: "p3", name: "[동물] 다람쥐" },
  { id: "p4", name: "[식물] 토마토" },
  { id: "p5", name: "[식물] 상추" },
];

// 한국어 검색에서 띄어쓰기/대소문자/유니코드 정규화 무시
function normKR(s) {
  return (s || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, ""); // 모든 공백 제거
}

// "[카테고리] 이름" 형태에서 카테고리/이름 분리
function parseCategoryAndName(raw) {
  const str = String(raw ?? "").trim();
  const m = str.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (m) {
    const category = m[1].trim();
    const name = (m[2] || "").trim();
    return { category: category || "기타", name: name || category };
  }
  return { category: "기타", name: str };
}

// 엑셀 헤더 후보들
const NAME_HEADERS = ["name", "part", "partname", "item", "품명", "이름", "부품", "부품명"];
const QTY_HEADERS = ["qty", "quantity", "수량"];

export default function PartSelectorApp() {
  const [query, setQuery] = useState("");
  const [parts, setParts] = useState(() =>
    SAMPLE_PARTS_RAW.map(({ id, name }) => {
      const { category, name: clean } = parseCategoryAndName(name);
      return { id, name: clean, category };
    })
  );
  const [selected, setSelected] = useState({}); // id -> qty
  const [activeCategory, setActiveCategory] = useState("전체");

  const categories = useMemo(() => {
    const set = new Set(parts.map((p) => p.category));
    return ["전체", ...Array.from(set)];
  }, [parts]);

  const filtered = useMemo(() => {
    const q = normKR(query.trim());
    return parts.filter((p) => {
      const catOk = activeCategory === "전체" || p.category === activeCategory;
      const txtOk = !q || normKR(p.name).includes(q);
      return catOk && txtOk;
    });
  }, [query, parts, activeCategory]);

  const output = useMemo(() => {
    const items = parts
      .filter((p) => selected[p.id] && selected[p.id] > 0)
      .map((p) => {
        const qty = selected[p.id];
        return qty === 1 ? `${p.name}` : `${p.name}x${qty}`;
      });
    // 공백 완전히 제거
    return items.join(",").replace(/\s+/g, "");
  }, [parts, selected]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  }

  function setQty(id, qty) {
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    setSelected((prev) => ({ ...prev, [id]: q })); // 수량 입력 시 자동 선택
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      alert("복사되었습니다!");
    } catch (e) {
      console.error(e);
      alert("복사에 실패했어요. 수동으로 복사해 주세요.");
    }
  }

  function clearAll() {
    setSelected({});
  }

  // === Excel 업로드 전용 ===
  function parseExcelRowsToParts(rows) {
    // rows: 2D array (header + data)
    if (!rows || rows.length === 0) return [];

    const headerRow = rows[0].map((h) => String(h || "").trim());
    const lowerHeaders = headerRow.map((h) => h.toLowerCase());

    let nameIdx = -1;
    let qtyIdx = -1;

    for (let i = 0; i < lowerHeaders.length; i++) {
      const h = lowerHeaders[i];
      if (nameIdx === -1 && NAME_HEADERS.includes(h)) nameIdx = i;
      if (qtyIdx === -1 && QTY_HEADERS.includes(h)) qtyIdx = i;
    }

    const hasHeader = nameIdx !== -1 || qtyIdx !== -1;
    if (!hasHeader) nameIdx = 0; // 헤더 없으면 첫 열을 이름으로 간주

    const start = hasHeader ? 1 : 0;
    const out = [];

    for (let r = start; r < rows.length; r++) {
      const row = rows[r] || [];
      const rawName = row[nameIdx];
      const { category, name } = parseCategoryAndName(rawName);
      if (!name) continue;

      const id = `p-${r}-${Date.now()}`;
      const rec = { id, name, category };

      if (qtyIdx !== -1) {
        const q = Number(row[qtyIdx]);
        if (!Number.isNaN(q) && q > 0) rec._qty = Math.floor(q);
      }

      out.push(rec);
    }

    return out;
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const wb = XLSX.read(data, { type: "array" });
        const firstSheet = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheet];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const parsed = parseExcelRowsToParts(rows);
        if (parsed.length === 0) {
          alert("가져올 데이터가 없습니다. 첫 열에 [카테고리] 이름 형식으로 부품명을 두세요.");
          return;
        }
        setParts(parsed.map(({ id, name, category }) => ({ id, name, category })));

        // qty가 있으면 선택에 기본값 반영
        const initialSelected = {};
        parsed.forEach((p) => {
          if (p._qty && p._qty > 0) initialSelected[p.id] = p._qty;
        });
        setSelected(initialSelected);
        setQuery("");
        setActiveCategory("전체");
      } catch (err) {
        console.error(err);
        alert("파일을 읽는 중 문제가 발생했습니다. .xlsx/.xls/.csv 형식을 사용해주세요.");
      }
    };

    reader.readAsArrayBuffer(file);
    // 같은 파일 재업로드 허용 위해 초기화
    e.target.value = "";
  }

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex items-center justify-center py-10">
      <div className="w-full max-w-5xl px-4">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-semibold">부품 선택 → 쉼표 데이터 생성기</h1>
          <p className="text-neutral-400 mt-1 text-sm md:text-base">
            엑셀(.xlsx/.xls/.csv) 업로드 → 카테고리 선택 → 검색(띄어쓰기 무시) → 체크/수량 → <span className="font-mono">이름x수량</span> 또는 <span className="font-mono">이름</span>으로 자동 출력됩니다.
          </p>
        </header>

        {/* Top Controls */}
        <div className="grid grid-cols-1 gap-3 mb-4">
          <div className="flex items-center gap-2">
            <label className="rounded-2xl px-3 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 cursor-pointer">
              파일 업로드
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                className="hidden"
              />
            </label>
            <input
              type="text"
              placeholder="부품 검색... (띄어쓰기 무시 검색)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-2xl px-4 py-2 bg-neutral-900 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2 overflow-x-auto custom-scroll">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-3 py-1 border ${activeCategory === cat ? "bg-indigo-600 border-indigo-500" : "bg-neutral-900 border-neutral-700 hover:bg-neutral-800"}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: List */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 md:p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">부품 리스트 ({filtered.length})</h2>
              <button onClick={clearAll} className="rounded-xl px-3 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">모두 지우기</button>
            </div>
            <div className="max-h-[420px] overflow-auto pr-1 custom-scroll">
              {filtered.length === 0 && (
                <div className="text-neutral-500 text-sm py-8 text-center">검색 결과가 없습니다.</div>
              )}
              <ul className="space-y-2">
                {filtered.map((p) => {
                  const isChecked = selected[p.id] != null && selected[p.id] > 0;
                  const qty = isChecked ? selected[p.id] : 1;
                  return (
                    <li key={p.id} className={`flex items-center gap-3 bg-neutral-950 border border-neutral-800 rounded-xl p-2 ${isChecked ? "ring-1 ring-indigo-500/40" : ""}`}>
                      <input
                        id={`chk-${p.id}`}
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(p.id)}
                        className="h-5 w-5 accent-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 whitespace-nowrap">[{p.category}]</span>
                          <span className="truncate">{p.name}</span>
                        </div>
                      </div>
                      {/* 수량은 항상 노출: 입력 시 자동 선택 */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-neutral-400">수량</span>
                        <input
                          type="number"
                          min={1}
                          value={qty}
                          onChange={(e) => setQty(p.id, e.target.value)}
                          className="w-20 rounded-xl px-3 py-1 bg-neutral-900 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Right: Selected & Output */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 md:p-4 shadow-lg flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">선택된 항목</h2>
            </div>

            {/* 선택된 칩들 */}
            <div className="flex flex-wrap gap-2 mb-4 min-h-[42px]">
              {parts.filter((p) => selected[p.id]).length === 0 ? (
                <span className="text-neutral-500 text-sm">선택된 항목이 없습니다.</span>
              ) : (
                parts
                  .filter((p) => selected[p.id])
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-full pl-3 pr-2 py-1">
                      <span className="text-sm">{selected[p.id] === 1 ? p.name : `${p.name}×${selected[p.id]}`}</span>
                      <button
                        onClick={() => toggleSelect(p.id)}
                        className="rounded-full px-2 py-1 hover:bg-neutral-800"
                        title="제거"
                      >
                        ✕
                      </button>
                    </div>
                  ))
              )}
            </div>

            {/* Output */}
            <div>
              <label className="text-sm text-neutral-400">출력 (쉼표로 구분된 텍스트, 공백 없음)</label>
              <textarea
                readOnly
                value={output}
                className="w-full h-32 mt-1 rounded-xl px-3 py-2 bg-black/60 border border-neutral-800 font-mono text-sm focus:outline-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={copyOutput}
                  disabled={!output}
                  className="rounded-2xl px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  복사하기
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-8 text-xs text-neutral-500">
          • 입력 형식 예: <span className="font-mono">[동물] 강아지</span>, <span className="font-mono">[식물] 상추</span>
          <br />• 출력 형식: <span className="font-mono">이름x수량,이름</span> (모든 공백 제거)
          <br />• 엑셀 헤더가 없다면 첫 열을 이름으로 간주합니다. (옵션) 수량 헤더가 있으면 기본 수량으로 반영합니다.
          
          <br />• 검색은 한국어 띄어쓰기를 무시하고, 카테고리 버튼으로 추가 필터링합니다.
        </footer>
      </div>

      <style>{`
        .custom-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 9999px; }
        .custom-scroll::-webkit-scrollbar-track { background: #18181b; }
      `}</style>
    </div>
  );
}
