import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { date, num } from "@/lib/format";

export default async function DeliveryNote({ params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const { id, deliveryId } = await params;
  const user = await requireUser(["supplier"]);
  const data = await withActor(user, async (tx) => {
    const d = await one<{ number: string; qr_token: string; scheduled_date: string | null; vehicle_no: string | null; driver_name: string | null; otp: string | null;
      po_number: string; delivery_location: string | null; contractor: string; supplier: string }>(tx,
      `select d.number, d.qr_token, d.scheduled_date, d.vehicle_no, d.driver_name, delivery_otp_for_supplier(d.id) as otp, po.po_number, po.delivery_location,
              c.name as contractor, s.name as supplier
       from deliveries d join purchase_orders po on po.id = d.po_id join organizations c on c.id = d.org_id join organizations s on s.id = d.supplier_org_id
       where d.id = $1 and d.po_id = $2`, [deliveryId, id]);
    if (!d) return null;
    const items = await rows<{ description: string; unit: string; qty_shipped: number }>(tx,
      "select pi.description, pi.unit, di.qty_shipped from delivery_items di join po_items pi on pi.id = di.po_item_id where di.delivery_id = $1 order by pi.line_no", [deliveryId]);
    return { d, items };
  });
  if (!data) notFound();
  const { d, items } = data;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = `${origin}/deliveries/verify/${d.qr_token}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });

  return (
    <div className="mx-auto max-w-3xl border border-line bg-white p-8 text-black">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Delivery note</div>
          <h1 className="text-2xl font-semibold">{d.number}</h1>
          <p className="mt-1 text-sm">{d.supplier} → {d.contractor}</p>
          <p className="text-sm">PO {d.po_number} · {date(d.scheduled_date)}</p>
          <p className="text-sm">Deliver to: {d.delivery_location}</p>
          <p className="text-sm">Vehicle {d.vehicle_no ?? "—"} · Driver {d.driver_name ?? "—"}</p>
        </div>
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Scan to verify delivery" width={160} height={160} />
          <div className="text-[11px] text-gray-500">Site: scan to verify receipt</div>
        </div>
      </div>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead><tr className="border-b border-gray-300 text-left"><th className="py-2">Material</th><th className="py-2 text-right">Quantity</th><th className="py-2 text-right">Received</th></tr></thead>
        <tbody>{items.map((i, k) => <tr key={k} className="border-b border-gray-200"><td className="py-2">{i.description}</td><td className="py-2 text-right">{num(i.qty_shipped)} {i.unit}</td><td className="py-2 text-right">________</td></tr>)}</tbody>
      </table>
      <div className="mt-6 border border-gray-300 p-3 text-sm">
        Driver&apos;s delivery code: <span className="font-mono text-lg font-semibold tracking-[0.3em]">{d.otp}</span>
        <div className="text-xs text-gray-500">Give this code to the site engineer only once the goods are offloaded and counted.</div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm"><div className="border-t border-gray-400 pt-1">Received by (site)</div><div className="border-t border-gray-400 pt-1">Driver</div></div>
      <div className="mt-6 flex justify-end"><PrintButton /></div>
    </div>
  );
}
