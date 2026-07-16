import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱。"),
  password: z.string().min(8, "密码至少需要 8 个字符。")
});

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2, "名称至少需要 2 个字符。").max(64, "名称不能超过 64 个字符。"),
    email: z.string().trim().email("请输入有效邮箱。"),
    password: z.string().min(8, "密码至少需要 8 个字符。"),
    confirmPassword: z.string().min(8, "请再次输入密码。")
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "两次输入的密码不一致。",
    path: ["confirmPassword"]
  });