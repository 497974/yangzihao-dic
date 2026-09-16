/**
 * 对话练习的内置场景（阶段五实现方案 · 步骤 4）。
 *
 * 挑选标准：出国、工作、日常里最常遇到，而且有明确的「要办成的事」——
 * 有目标的对话才练得出东西，漫无目的的闲聊很快就聊不下去。
 *
 * 给 AI 的角色设定写英文（模型按英文理解最稳定），给用户看的标题和目标写中文。
 */

export interface ConversationScenario {
  id: string
  /** 给用户看的场景名 */
  title: string
  /** 给用户看的：你要在这段对话里办成什么事 */
  goal: string
  /** 给 AI 的：在什么场合、扮演谁 */
  setting: string
  role: string
  /** 给 AI 的：学习者要达成的目标 */
  learnerGoal: string
  /** AI 的开场白（固定写好，进入场景不用先请求一次模型） */
  opening: string
}

export const BUILTIN_SCENARIOS: readonly ConversationScenario[] = [
  {
    id: "restaurant",
    title: "餐厅点餐",
    goal: "点一份主菜和饮料，问一道菜里有什么，最后结账",
    setting: "A casual restaurant at dinner time.",
    role: "A friendly waiter or waitress taking the learner's order.",
    learnerGoal: "Order a main course and a drink, ask what is in one dish, and ask for the bill.",
    opening: "Hi there, welcome in! Here's the menu. Can I get you something to drink first?",
  },
  {
    id: "hotel",
    title: "酒店入住",
    goal: "凭预订办理入住，问清早餐时间和无线网络",
    setting: "The front desk of a mid-range hotel in the evening.",
    role: "A polite front desk receptionist.",
    learnerGoal:
      "Check in with an existing reservation and ask about breakfast hours and the Wi-Fi.",
    opening: "Good evening, and welcome to the Riverside Hotel. Are you checking in tonight?",
  },
  {
    id: "directions",
    title: "问路",
    goal: "问到最近的地铁站怎么走，并确认大概要走多久",
    setting: "A busy street in a city the learner is visiting for the first time.",
    role: "A helpful local who knows the area well.",
    learnerGoal: "Find out how to get to the nearest subway station and how long it takes to walk.",
    opening: "You look a little lost. Can I help you find something?",
  },
  {
    id: "return",
    title: "商店退换货",
    goal: "说明一件外套尺码不合适，要求换货或退款",
    setting: "A clothing store's customer service counter.",
    role: "A store clerk who needs to follow the store's return policy.",
    learnerGoal:
      "Explain that a jacket bought last week does not fit, and arrange an exchange or a refund.",
    opening: "Hi, how can I help you today?",
  },
  {
    id: "doctor",
    title: "看病",
    goal: "描述自己的症状，听懂医生的建议和用药说明",
    setting: "A doctor's office at a local clinic.",
    role: "A calm, caring general practitioner.",
    learnerGoal:
      "Describe their symptoms clearly and understand the doctor's advice and medication.",
    opening: "Hello, please have a seat. So, what brings you in today?",
  },
  {
    id: "interview",
    title: "求职面试",
    goal: "介绍自己的经历，回答为什么想要这份工作",
    setting: "A job interview for an office position at a mid-sized company.",
    role: "A professional but friendly hiring manager.",
    learnerGoal: "Introduce their background and explain why they want this job.",
    opening:
      "Thanks for coming in today. Why don't you start by telling me a little about yourself?",
  },
  {
    id: "small-talk",
    title: "认识新朋友",
    goal: "和刚认识的人聊聊工作、兴趣爱好，交换联系方式",
    setting: "A friend's birthday party where the learner does not know many people.",
    role: "An outgoing guest who enjoys meeting new people.",
    learnerGoal: "Make small talk about work and hobbies, and exchange contact details.",
    opening: "Hey, I don't think we've met! I'm Alex. How do you know Sarah?",
  },
  {
    id: "appointment",
    title: "电话预约",
    goal: "打电话给牙科诊所，预约下周的看诊时间",
    setting: "A phone call to a dental clinic.",
    role: "A receptionist managing the clinic's appointment schedule.",
    learnerGoal: "Book a dental check-up for next week at a time that works for them.",
    opening: "Good morning, Bright Smile Dental. How can I help you?",
  },
]

/** 用户一句话描述的自定义场景：AI 自己把它补全成可以扮演的情境 */
export function customScenario(description: string): ConversationScenario {
  const text = description.trim()
  return {
    id: "custom",
    title: "自定义场景",
    goal: text,
    setting: `A situation described by the learner (possibly in Chinese): ${text}`,
    role: "The most natural conversation partner for this situation. Decide the details yourself.",
    learnerGoal: `Handle this situation successfully in English: ${text}`,
    opening: "",
  }
}
