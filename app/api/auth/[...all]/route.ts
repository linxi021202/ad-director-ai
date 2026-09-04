import { NextResponse } from "next/server";

function accountSystemRemoved() {
  return NextResponse.json({
    success: false,
    error: "账号系统已停用，请直接使用匿名工作台。"
  }, {
    status: 410,
    headers: { "cache-control": "no-store" }
  });
}

export const GET = accountSystemRemoved;
export const POST = accountSystemRemoved;
