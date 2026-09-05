/**
 * 还原被塌成 never 的 ORPC 错误构造器。
 *
 * @orpc/contract 里 ErrorMap 的每个键都是可选的：
 *
 *     type ErrorMap = { [key in ORPCErrorCode]?: ErrorMapItem<AnySchema> }
 *
 * 上游契约包的 pickPublicErrorMap() 返回 Pick<ErrorMap, TCodes[number]>，
 * 而 Pick **保留可选性**，于是值类型是 `ErrorMapItem | undefined`。
 * ORPC 生成构造器映射时做的是：
 *
 *     [K in keyof T]: T[K] extends ErrorMapItem<infer U> ? (...) => ORPCError : never
 *
 * 带 undefined 的值匹配不上 ErrorMapItem，整个映射塌成 never，
 * 于是 `errors.XXX()` 被判成 "This expression is not callable"。
 *
 * 关键是：**运行时构造器一直是真实存在的**（ORPC 按契约声明生成），
 * 塌掉的只有类型。所以这里做的是还原形状，而不是绕过检查：
 * 键名仍然来自契约本身，错误码写错照样编译不过；
 * 只有调用签名是本地补的。没有任何运行时开销——纯类型转换。
 *
 * 这是上游 @read-frog/api-contract 的类型缺陷，等上游把 pickPublicErrorMap
 * 的返回类型改成必填（如 `Required<Pick<ErrorMap, TCodes[number]>>`）之后，
 * 本文件即可整体删除。
 */

/** ORPC 错误构造器接受的选项，对应 ORPCErrorConstructorMapItemOptions */
export interface ORPCErrorCtorOptions {
  message?: string
  data?: unknown
  cause?: unknown
}

/** 把 never 值的错误映射还原成「每个键都是构造器」的形状 */
export type CallableErrors<T> = {
  [K in keyof T]: (options?: ORPCErrorCtorOptions) => Error
}

/**
 * 用法：`throw errs(errors).NOTEBASE_NOT_FOUND()`
 *
 * 之所以保留 `errors` 参数而不是直接造一个全局对象，是为了让键名继续受契约约束：
 * 传进来的是这个过程真实声明的错误集合，访问未声明的错误码依然会报错。
 */
export function errs<T extends object>(errors: T): CallableErrors<T> {
  return errors as unknown as CallableErrors<T>
}
