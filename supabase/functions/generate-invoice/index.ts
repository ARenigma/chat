/**
 * generate-invoice — server-side GST invoice generator.
 *
 * Caller: service_role only (verified by decoding the Bearer JWT and asserting
 * role === 'service_role', mirroring send-push).
 *
 * Flow:
 *   1. Load the token_transaction and buyer profile.
 *   2. Compute GST amounts in integer paise.
 *   3. Determine fiscal year in IST (Apr–Mar).
 *   4. Call record_invoice RPC → obtain id + invoice_number.
 *   5. Render a clean A4 PDF with pdf-lib.
 *   6. Upload to storage bucket 'invoices'.
 *   7. Call set_invoice_pdf RPC.
 *   8. Return { invoice_id, invoice_number, document_type, pdf_path }.
 *
 * GST path (when SELLER_GSTIN is set):
 *   document_type = 'tax_invoice'
 *   taxable = round(total * 10000 / (10000 + rate_bps))
 *   tax = total - taxable
 *   intra-state (buyer.state === SELLER_STATE): CGST = floor(tax/2), SGST = tax - CGST
 *   inter-state or buyer state unknown: IGST = tax
 *
 * No-GSTIN path (today's production path, SELLER_GSTIN is empty):
 *   document_type = 'bill_of_supply'
 *   taxable = total, cgst = sgst = igst = 0, gst_rate_bps = 0
 *   A bill of supply shows no tax line (unregistered / composition).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1';

// ---------------------------------------------------------------------------
// Auth guard: mirrors send-push exactly — decode the Bearer JWT, assert role.
// ---------------------------------------------------------------------------
function extractRole(request: Request): string {
  const auth = request.headers.get('Authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  try {
    return (JSON.parse(atob(jwt.split('.')[1] ?? '')) as Record<string, unknown>).role as string ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Fiscal year helper (IST = UTC+5:30)
// ---------------------------------------------------------------------------
function fiscalYear(now: Date): string {
  // Convert UTC to IST by adding 5h30m = 330 minutes
  const istMs = now.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const month = ist.getUTCMonth() + 1; // 1-indexed
  const year = ist.getUTCFullYear();
  // Apr (4) – Mar boundary
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = (fyStart + 1) % 100; // last two digits
  return `${fyStart}-${String(fyEnd).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Currency formatter: paise → "Rs. NNN.NN"
//
// "Rs." rather than the ₹ glyph on purpose: the PDF uses pdf-lib's StandardFonts
// (Helvetica), which are WinAnsi-encoded and cannot encode U+20B9 (₹) — drawing
// it throws "WinAnsi cannot encode". "Rs." is the standard ASCII rendering on an
// Indian invoice and needs no embedded Unicode font. (The app UI still shows ₹.)
// ---------------------------------------------------------------------------
function paiseToRupeeStr(paise: number): string {
  const rupees = paise / 100;
  return `Rs. ${rupees.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// PDF renderer (pdf-lib A4)
// ---------------------------------------------------------------------------
async function buildPdf(opts: {
  sellerLegalName: string;
  sellerAddress: string;
  sellerEmail: string;
  sellerGstin: string;
  sellerSac: string;
  documentTitle: string;
  invoiceNumber: string;
  issuedAt: Date;
  buyerName: string;
  tokens: number;
  totalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  documentType: 'tax_invoice' | 'bill_of_supply';
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // A4: 595 x 842 pt
  const page = doc.addPage([595, 842]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.05, 0.05, 0.05);
  const grey = rgb(0.45, 0.45, 0.45);
  const hairline = rgb(0.8, 0.8, 0.8);
  const margin = 48;
  const contentWidth = 595 - margin * 2;

  let y = 800;

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    size: number,
    font = helvetica,
    color = black,
  ) => page.drawText(text, { x, y: yPos, size, font, color });

  const drawLine = (yPos: number) =>
    page.drawLine({
      start: { x: margin, y: yPos },
      end: { x: margin + contentWidth, y: yPos },
      thickness: 0.5,
      color: hairline,
    });

  // --- Seller header -------------------------------------------------------
  drawText(opts.sellerLegalName, margin, y, 16, helveticaBold);
  y -= 20;
  drawText(opts.sellerAddress, margin, y, 9, helvetica, grey);
  y -= 14;
  drawText(opts.sellerEmail, margin, y, 9, helvetica, grey);
  if (opts.sellerGstin) {
    y -= 14;
    drawText(`GSTIN: ${opts.sellerGstin}`, margin, y, 9, helvetica, grey);
  }

  // --- Document title (right-aligned) ---------------------------------------
  const titleSize = 13;
  const titleWidth = helveticaBold.widthOfTextAtSize(opts.documentTitle, titleSize);
  drawText(opts.documentTitle, margin + contentWidth - titleWidth, 800, titleSize, helveticaBold);

  // --- Divider --------------------------------------------------------------
  y -= 16;
  drawLine(y);
  y -= 18;

  // --- Invoice meta --------------------------------------------------------
  drawText('Invoice Number:', margin, y, 9, helvetica, grey);
  drawText(opts.invoiceNumber, margin + 100, y, 9, helveticaBold);
  const dateStr = opts.issuedAt.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
  const dateLabel = 'Date:';
  const dateLabelWidth = helvetica.widthOfTextAtSize(dateLabel, 9);
  drawText(dateLabel, margin + contentWidth - 120, y, 9, helvetica, grey);
  drawText(dateStr, margin + contentWidth - 120 + dateLabelWidth + 4, y, 9, helveticaBold);
  y -= 14;
  drawText('Bill To:', margin, y, 9, helvetica, grey);
  drawText(opts.buyerName, margin + 100, y, 9, helveticaBold);

  // --- Line items table header ----------------------------------------------
  y -= 28;
  drawLine(y + 16);
  drawText('Description', margin, y, 9, helveticaBold);
  drawText('SAC', margin + 320, y, 9, helveticaBold);
  drawText('Qty', margin + 380, y, 9, helveticaBold);
  drawText('Amount', margin + contentWidth - 60, y, 9, helveticaBold);
  y -= 4;
  drawLine(y);
  y -= 18;

  // --- Single line item ----------------------------------------------------
  const desc = `Pappal wallet top-up — ${opts.tokens.toLocaleString('en-IN')} tokens`;
  drawText(desc, margin, y, 9);
  drawText(opts.sellerSac, margin + 320, y, 9);
  drawText('1', margin + 380, y, 9);
  drawText(paiseToRupeeStr(opts.totalPaise), margin + contentWidth - 60, y, 9);

  y -= 16;
  drawLine(y);
  y -= 20;

  // --- Totals block --------------------------------------------------------
  const labelX = margin + contentWidth - 200;
  const valueX = margin + contentWidth - 60;

  if (opts.documentType === 'tax_invoice') {
    drawText('Taxable Amount:', labelX, y, 9, helvetica, grey);
    drawText(paiseToRupeeStr(opts.taxablePaise), valueX, y, 9);
    y -= 16;
    if (opts.cgstPaise > 0 || opts.sgstPaise > 0) {
      drawText('CGST:', labelX, y, 9, helvetica, grey);
      drawText(paiseToRupeeStr(opts.cgstPaise), valueX, y, 9);
      y -= 16;
      drawText('SGST:', labelX, y, 9, helvetica, grey);
      drawText(paiseToRupeeStr(opts.sgstPaise), valueX, y, 9);
      y -= 16;
    } else if (opts.igstPaise > 0) {
      drawText('IGST:', labelX, y, 9, helvetica, grey);
      drawText(paiseToRupeeStr(opts.igstPaise), valueX, y, 9);
      y -= 16;
    }
  } else {
    // bill_of_supply: no tax lines
    drawText('Amount:', labelX, y, 9, helvetica, grey);
    drawText(paiseToRupeeStr(opts.totalPaise), valueX, y, 9);
    y -= 16;
  }

  drawLine(y);
  y -= 16;
  drawText('Total:', labelX, y, 11, helveticaBold);
  drawText(paiseToRupeeStr(opts.totalPaise), valueX, y, 11, helveticaBold);

  if (opts.documentType === 'bill_of_supply') {
    y -= 16;
    drawText('Not registered for GST — no tax charged.', labelX, y, 8, helvetica, grey);
  }

  // --- Footer --------------------------------------------------------------
  y -= 36;
  drawLine(y);
  y -= 14;
  drawText(
    'This is a computer-generated document.',
    margin,
    y,
    8,
    helvetica,
    grey,
  );

  return doc.save();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'not configured' }), { status: 500 });
  }

  const role = extractRole(request);
  if (role !== 'service_role') {
    return Response.json({ error: 'forbidden' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { transaction_id?: string };
    const transactionId = body.transaction_id;
    if (!transactionId) {
      return Response.json({ error: 'transaction_id is required' }, { status: 400 });
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Load the transaction -----------------------------------------------
    const { data: txRow, error: txErr } = await admin
      .from('token_transactions')
      .select('id, user_id, kind, status, amount_paise, tokens_delta')
      .eq('id', transactionId)
      .single();

    if (txErr || !txRow) {
      return Response.json({ error: 'transaction not found' }, { status: 400 });
    }
    if ((txRow as { status: string }).status !== 'succeeded') {
      return Response.json({ error: 'transaction is not succeeded' }, { status: 400 });
    }

    const tx = txRow as {
      id: string;
      user_id: string;
      amount_paise: number;
      tokens_delta: number;
    };

    // Load buyer display name from profiles
    const { data: profileRow } = await admin
      .from('profiles')
      .select('id')
      .eq('id', tx.user_id)
      .single();
    const buyerName = profileRow ? `User ${tx.user_id.slice(0, 8)}` : 'Valued Customer';

    // 2. Seller config from env --------------------------------------------
    const sellerLegalName = Deno.env.get('SELLER_LEGAL_NAME') ?? 'Axionix Technologies';
    const sellerAddress = Deno.env.get('SELLER_ADDRESS') ?? 'Noida, Uttar Pradesh, India';
    const sellerState = Deno.env.get('SELLER_STATE') ?? 'Uttar Pradesh';
    const sellerEmail = Deno.env.get('SELLER_EMAIL') ?? 'hello@pappal.live';
    const sellerGstin = Deno.env.get('SELLER_GSTIN') ?? '';
    const sellerSac = Deno.env.get('SELLER_SAC') ?? '998439';

    /*
     * The GST rate comes from the ADMIN CONFIG, not from this function's own
     * environment — one source of truth, because there were two.
     *
     * `GST_RATE_BPS` here and `economics.gst_rate_bps` in the admin control
     * plane (migration 026, read by the app through `get_active_config`) were
     * independent values that happened to agree only because both defaulted to
     * 1800. Nothing tied them together, so publishing a new rate from the admin
     * dashboard would have changed every price the app displays while this
     * function kept taxing at the old rate — and the invoice is the legal
     * document, so the disagreement would have been in the worst possible
     * place. `get_active_config` is the same RPC the client calls
     * (src/api/appConfig.ts `fetchAuthConfig`), so screen and invoice now read
     * one number by construction rather than by coincidence (Amit, 2026-09-07).
     *
     * The env var is still honoured as the FALLBACK: if the RPC fails or the
     * domain has no published version, an invoice must still be issuable. A
     * failed config read must never become a failed invoice.
     */
    const gstRateBpsEnvFallback = parseInt(Deno.env.get('GST_RATE_BPS') ?? '1800', 10);
    const { data: economics } = await admin.rpc('get_active_config', {
      p_domain: 'economics',
    });
    const configuredRate = (economics as { gst_rate_bps?: number } | null)?.gst_rate_bps;
    const gstRateBpsEnv =
      typeof configuredRate === 'number' && Number.isInteger(configuredRate) && configuredRate >= 0
        ? configuredRate
        : gstRateBpsEnvFallback;

    // 3. GST computation (integer paise, exact) ----------------------------
    const totalPaise = tx.amount_paise;
    let documentType: 'tax_invoice' | 'bill_of_supply';
    let taxablePaise: number;
    let cgstPaise: number;
    let sgstPaise: number;
    let igstPaise: number;
    let gstRateBps: number;
    let placeOfSupply: string;

    if (sellerGstin) {
      // Registered seller: compute tax
      // taxable = round(total * 10000 / (10000 + rate_bps)) — exact integer paise
      documentType = 'tax_invoice';
      gstRateBps = gstRateBpsEnv;
      taxablePaise = Math.round((totalPaise * 10000) / (10000 + gstRateBps));
      const taxPaise = totalPaise - taxablePaise;

      // Buyer state is not collected from anonymous B2C users at recharge time.
      // We default to intra-state (seller state) per GST rules for B2C supplies
      // where the place of supply is the seller's state when buyer state is
      // unknown. This path is dormant until SELLER_GSTIN is configured.
      // When buyer state becomes available (e.g., via billing address), pass it
      // in the buyer jsonb and compare against sellerState here.
      const buyerState: string | null = null; // not collected yet
      placeOfSupply = buyerState ?? sellerState;
      const isIntraState = placeOfSupply === sellerState;

      if (isIntraState) {
        cgstPaise = Math.floor(taxPaise / 2);
        sgstPaise = taxPaise - cgstPaise;
        igstPaise = 0;
      } else {
        igstPaise = taxPaise;
        cgstPaise = 0;
        sgstPaise = 0;
      }
    } else {
      // Unregistered seller: bill of supply, no tax
      documentType = 'bill_of_supply';
      taxablePaise = totalPaise;
      cgstPaise = 0;
      sgstPaise = 0;
      igstPaise = 0;
      gstRateBps = 0;
      placeOfSupply = sellerState;
    }

    // 4. Fiscal year (IST) -------------------------------------------------
    const now = new Date();
    const fy = fiscalYear(now);

    // 5. record_invoice RPC ------------------------------------------------
    const { data: invoiceData, error: invoiceErr } = await admin.rpc('record_invoice', {
      p_transaction_id: tx.id,
      p_document_type: documentType,
      p_fy: fy,
      p_seller: {
        legal_name: sellerLegalName,
        address: sellerAddress,
        gstin: sellerGstin,
        email: sellerEmail,
        state: sellerState,
      },
      p_buyer: { name: buyerName, state: null, gstin: null },
      p_place_of_supply: placeOfSupply,
      p_taxable_paise: taxablePaise,
      p_cgst_paise: cgstPaise,
      p_sgst_paise: sgstPaise,
      p_igst_paise: igstPaise,
      p_total_paise: totalPaise,
      p_gst_rate_bps: gstRateBps,
    });

    if (invoiceErr || !invoiceData) {
      console.error('record_invoice RPC failed:', invoiceErr?.message);
      return Response.json({ error: 'could not record invoice' }, { status: 500 });
    }

    const { id: invoiceId, invoice_number: invoiceNumber } = invoiceData as {
      id: string;
      invoice_number: string;
    };

    // 6. Render PDF --------------------------------------------------------
    const documentTitle = documentType === 'tax_invoice' ? 'TAX INVOICE' : 'BILL OF SUPPLY';
    const pdfBytes = await buildPdf({
      sellerLegalName,
      sellerAddress,
      sellerEmail,
      sellerGstin,
      sellerSac,
      documentTitle,
      invoiceNumber,
      issuedAt: now,
      buyerName,
      tokens: tx.tokens_delta,
      totalPaise,
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      documentType,
    });

    // 7. Upload PDF to storage bucket 'invoices' ---------------------------
    // Path: '<user_id>/<invoice_number-with-slashes-replaced>.pdf'
    const safeName = invoiceNumber.replaceAll('/', '-');
    const pdfPath = `${tx.user_id}/${safeName}.pdf`;

    const { error: uploadErr } = await admin.storage
      .from('invoices')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
      return Response.json({ error: 'could not upload PDF' }, { status: 500 });
    }

    // 8. set_invoice_pdf RPC -----------------------------------------------
    const { error: pdfErr } = await admin.rpc('set_invoice_pdf', {
      p_invoice_id: invoiceId,
      p_pdf_path: pdfPath,
    });
    if (pdfErr) {
      console.error('set_invoice_pdf RPC failed:', pdfErr.message);
      // Non-fatal: the invoice row exists and the PDF is in storage; just the
      // pointer is missing. A retry will fix it.
    }

    return Response.json({ invoice_id: invoiceId, invoice_number: invoiceNumber, document_type: documentType, pdf_path: pdfPath });
  } catch (err) {
    console.error('generate-invoice error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
