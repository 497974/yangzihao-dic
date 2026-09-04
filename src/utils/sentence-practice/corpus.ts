/**
 * 造句练习 · 内置语料库
 *
 * 选句标准（按用户要求）：
 *   - **日常高频**：真实对话里用得上，不是教科书腔
 *   - **不幼稚**：排除 "How are you" / "My name is" 这种小学生水平
 *   - **看得懂但说不出**：这才是造句练习的靶子——中文意思一看就懂，
 *     真要用英文说出来却卡壳，正好是「理解」到「表达」之间那道坎
 *   - **句子短**：4~10 词。造句是从零拼整句，28 词的句子只会劝退
 *
 * 每句都带 pattern（句式骨架）和 note（为什么这么说）。答完题展开，
 * 否则做对了也是蒙的，做错了更不知道错在哪。这些讲解是预写死的，
 * 不走 AI —— 零延迟、零 token、离线可用。
 *
 * 全部为本项目原创编写，不取自任何课程包或教材，可自由随扩展分发。
 */

export interface CorpusSentence {
  id: string
  en: string
  zh: string
  /** 场景标签 */
  scene: string
  /** 句式骨架，如 "must have + 过去分词" */
  pattern: string
  /** 为什么这么说：语法要点、地道用法、易错处 */
  note: string
}

export const SENTENCE_CORPUS: CorpusSentence[] = [
  // ── 请求帮忙 ──
  {
    id: "c01",
    scene: "请求帮忙",
    en: "Could you give me a hand with this?",
    zh: "你能帮我搭把手吗？",
    pattern: "Could you + 动词原形…?",
    note: "give sb a hand 是「搭把手」的地道说法，比 help me 更口语、分量更轻，适合小忙。用 Could 而不是 Can，语气更客气。with this 指明帮什么。",
  },
  {
    id: "c02",
    scene: "请求帮忙",
    en: "Would you mind taking a look at this?",
    zh: "你介意帮我看一下这个吗？",
    pattern: "Would you mind + 动名词?",
    note: "mind 后面必须接动名词 taking，不能用不定式。注意回答陷阱：愿意帮忙要说 Not at all（不介意），说 Yes 反而是拒绝。",
  },
  {
    id: "c03",
    scene: "请求帮忙",
    en: "I was wondering if you could help me out.",
    zh: "我想问问你能不能帮我一下。",
    pattern: "I was wondering if + 从句",
    note: "明明是当下的请求却用过去时 was wondering —— 这是英语的「距离感」礼貌：时态往回推一步，语气就软一层。help out 比 help 更强调帮人脱困。",
  },
  {
    id: "c04",
    scene: "请求帮忙",
    en: "Do you have a minute to go over this?",
    zh: "你有空过一下这个吗？",
    pattern: "have a minute to + 动词原形",
    note: "a minute 不是字面的一分钟，是「一小会儿」。go over 意为「逐项过一遍」，比 check 更强调一起走流程，不是你自己看。",
  },
  {
    id: "c05",
    scene: "请求帮忙",
    en: "Let me know if you need anything else.",
    zh: "还需要什么就告诉我。",
    pattern: "Let me know if + 从句",
    note: "let sb know 是「告知」的日常说法，比 tell me 更委婉。anything else 用于收尾，暗示「我这边说完了」，是很自然的话题结束方式。",
  },

  // ── 婉拒推辞 ──
  {
    id: "c06",
    scene: "婉拒推辞",
    en: "I'd rather not get into that right now.",
    zh: "我现在不太想聊这个。",
    pattern: "would rather not + 动词原形",
    note: "would rather 后接动词原形，否定直接加 not，不能用 don't。get into 这里是「深入聊某个话题」。整句是很体面的回避，不伤人也不用解释。",
  },
  {
    id: "c07",
    scene: "婉拒推辞",
    en: "I'm afraid that won't work for me.",
    zh: "恐怕那样对我不太合适。",
    pattern: "I'm afraid + 从句",
    note: "I'm afraid 不是「害怕」，是引出坏消息的缓冲语。work for sb 意为「对某人行得通」，说时间、方案、价格都能用，是极高频的万能搭配。",
  },
  {
    id: "c08",
    scene: "婉拒推辞",
    en: "Can I get back to you on that?",
    zh: "这件事我回头答复你行吗？",
    pattern: "get back to sb on sth",
    note: "get back to sb 是「稍后答复」，职场高频。on that 指明关于哪件事。用来争取思考时间，比直接说 I don't know 得体得多。",
  },
  {
    id: "c09",
    scene: "婉拒推辞",
    en: "I'll have to pass this time.",
    zh: "这次我就不参加了。",
    pattern: "have to pass",
    note: "pass 源自打牌轮到你时说「过」，引申为「这次略过」。比 I can't come 更轻松，而且不需要给理由，对方也不会追问。",
  },
  {
    id: "c10",
    scene: "婉拒推辞",
    en: "That's not really my call to make.",
    zh: "这不是我能决定的。",
    pattern: "sb's call to make",
    note: "call 作名词是「决定权」。这句把事情交回给该拍板的人，又不显得推诿。really 起软化作用，去掉会显得生硬。",
  },

  // ── 表达看法 ──
  {
    id: "c11",
    scene: "表达看法",
    en: "I see where you're coming from.",
    zh: "我理解你的出发点。",
    pattern: "see where sb is coming from",
    note: "字面是「我看得出你从哪儿来」，实际指「我明白你为什么这么想」。常用于理解但不一定同意——后面往往接 but。",
  },
  {
    id: "c12",
    scene: "表达看法",
    en: "That's a fair point, but I still have concerns.",
    zh: "有道理，但我还是有顾虑。",
    pattern: "That's a fair point, but…",
    note: "fair point 是「这话在理」的标准让步说法。先肯定再转折，是英语讨论里降低对抗感的固定套路。concerns 比 problems 更中性。",
  },
  {
    id: "c13",
    scene: "表达看法",
    en: "I'm not entirely convinced.",
    zh: "我还没完全被说服。",
    pattern: "not entirely + 形容词",
    note: "用 not entirely（不完全）而不是 not（不），是典型的含蓄表达——留余地，不把话说死。convinced 用被动形式描述自己的状态。",
  },
  {
    id: "c14",
    scene: "表达看法",
    en: "It depends on how you look at it.",
    zh: "这取决于你怎么看。",
    pattern: "depend on + 疑问词从句",
    note: "depend on 后接从句时必须用陈述语序 how you look at it，不能写成 how do you look at it。这是中国学生最常犯的语序错误之一。",
  },
  {
    id: "c15",
    scene: "表达看法",
    en: "I'd say it's worth a shot.",
    zh: "我觉得值得一试。",
    pattern: "worth + 名词",
    note: "I'd say 把断言弱化成个人意见，比 I think 更轻。worth a shot 里 shot 是「尝试」，比 worth trying 更口语。",
  },

  // ── 约时间 ──
  {
    id: "c16",
    scene: "约时间",
    en: "Something came up, can we reschedule?",
    zh: "临时有事，能改个时间吗？",
    pattern: "something came up",
    note: "come up 意为「临时冒出来」。这是改期时的万能理由，不必说明具体什么事，对方也不会追问——属于社交默契。",
  },
  {
    id: "c17",
    scene: "约时间",
    en: "Does Thursday afternoon work for you?",
    zh: "周四下午你方便吗？",
    pattern: "Does + 时间 + work for you?",
    note: "又是 work for sb，这次说时间是否合适。比 Are you free 更聚焦「这个点行不行」，也更容易拿到明确答复。",
  },
  {
    id: "c18",
    scene: "约时间",
    en: "I'm tied up until about four.",
    zh: "我要忙到四点左右。",
    pattern: "be tied up",
    note: "tied up 字面「被绑住」，引申为「脱不开身」。比 I'm busy 更具体，暗示手头有事走不开，而不是笼统地忙。",
  },
  {
    id: "c19",
    scene: "约时间",
    en: "Let's push it back a couple of days.",
    zh: "我们往后推几天吧。",
    pattern: "push sth back",
    note: "push back 是「往后推」；往前挪是 move up，不是 push forward——这个反直觉，容易记错。a couple of 口语里泛指「两三个」，不必精确。",
  },
  {
    id: "c20",
    scene: "约时间",
    en: "There's no rush on my end.",
    zh: "我这边不急。",
    pattern: "on sb's end",
    note: "on my end 是「我这边」，邮件里极高频。整句主动给对方减压，比 Take your time 更明确地表明压力不来自你。",
  },

  // ── 道歉解释 ──
  {
    id: "c21",
    scene: "道歉解释",
    en: "Sorry, I completely lost track of time.",
    zh: "抱歉，我完全忘了时间。",
    pattern: "lose track of sth",
    note: "lose track of 是「失去对…的追踪」，接 time 就是忘了时间。这是迟到时的标准解释，听起来是无心，而不是不重视。",
  },
  {
    id: "c22",
    scene: "道歉解释",
    en: "I didn't mean it that way.",
    zh: "我不是那个意思。",
    pattern: "mean sth + 方式",
    note: "mean 在这里是「是那个意思」。that way 指对方理解偏的那个方向。话说岔了之后的即时补救，比单说 Sorry 更能澄清误会。",
  },
  {
    id: "c23",
    scene: "道歉解释",
    en: "That was totally on me.",
    zh: "那完全是我的问题。",
    pattern: "be on sb",
    note: "on sb 表示「责任在某人身上」。买单时说 It's on me（我请）是同一个结构——语境决定它是「责任」还是「请客」。",
  },
  {
    id: "c24",
    scene: "道歉解释",
    en: "It slipped my mind entirely.",
    zh: "我彻底把这事忘了。",
    pattern: "sth slips one's mind",
    note: "注意主语是「事情」不是「我」——事情自己从脑子里溜走了。这种把责任推给事情的说法，比 I forgot 显得没那么不上心。",
  },
  {
    id: "c25",
    scene: "道歉解释",
    en: "I should have said something earlier.",
    zh: "我早该说的。",
    pattern: "should have + 过去分词",
    note: "should have done 表示「过去本该做却没做」，带自责。这是英语表达后悔的核心结构，have 绝不能省——省了意思就变成「现在应该说」。",
  },

  // ── 确认澄清 ──
  {
    id: "c26",
    scene: "确认澄清",
    en: "Just to make sure I understand you correctly.",
    zh: "我确认一下有没有理解对。",
    pattern: "Just to make sure + 从句",
    note: "以 Just to… 开头的不完整句，是会议里的常用引子，后面接着复述对方的话。Just 起弱化作用：我不是质疑你，只是核对。",
  },
  {
    id: "c27",
    scene: "确认澄清",
    en: "Are we still on for tomorrow?",
    zh: "明天还照原计划吗？",
    pattern: "be on for + 时间",
    note: "on 在这里是「计划仍然有效」。still 强调之前说好过。比 Is the meeting still happening 短得多，熟人之间就这么问。",
  },
  {
    id: "c28",
    scene: "确认澄清",
    en: "Let me double-check and get back to you.",
    zh: "我再确认一下回复你。",
    pattern: "double-check + and get back to you",
    note: "double-check 是「再核对一遍」，不是「检查两次」。这个组合是职场标准回复：先核实再答复，既不敷衍也不乱承诺。",
  },
  {
    id: "c29",
    scene: "确认澄清",
    en: "Correct me if I'm wrong.",
    zh: "说错了你纠正我。",
    pattern: "祈使句 + if 从句",
    note: "放在观点前面，表示「以下是我的理解，不对请指出」。表面谦虚，实际常用来礼貌地提出质疑，是很好用的缓冲。",
  },
  {
    id: "c30",
    scene: "确认澄清",
    en: "What exactly do you mean by that?",
    zh: "你说的具体是什么意思？",
    pattern: "What do you mean by + 名词?",
    note: "by that 指「你说那句话的意思」，介词 by 不能漏。exactly 表示「具体地」，但语气偏冲——想中性一点就去掉它。",
  },

  // ── 工作沟通 ──
  {
    id: "c31",
    scene: "工作沟通",
    en: "I'll keep you posted on the progress.",
    zh: "有进展我随时同步给你。",
    pattern: "keep sb posted (on sth)",
    note: "posted 源自「张贴告示」，keep sb posted 就是持续告知最新情况。比 I'll tell you later 专业，暗示我会主动更新，不用你来催。",
  },
  {
    id: "c32",
    scene: "工作沟通",
    en: "Let's circle back to this next week.",
    zh: "这件事我们下周再谈。",
    pattern: "circle back to sth",
    note: "circle back 是「绕回来再谈」，用来搁置话题而不显得否定。近年职场英语高频，比 discuss it later 更常听到。",
  },
  {
    id: "c33",
    scene: "工作沟通",
    en: "That's outside the scope of this project.",
    zh: "那超出这个项目的范围了。",
    pattern: "outside the scope of sth",
    note: "scope 是「范围、边界」。拒绝额外需求的专业说法——不说「我不做」，而说「这不在范围内」，把问题从人转到事。",
  },
  {
    id: "c34",
    scene: "工作沟通",
    en: "Can you walk me through it one more time?",
    zh: "你能再带我过一遍吗？",
    pattern: "walk sb through sth",
    note: "walk sb through 是「带着某人一步步走一遍」，比 explain 更强调按顺序演示。one more time 比 again 更客气。",
  },
  {
    id: "c35",
    scene: "工作沟通",
    en: "I want to make sure we're on the same page.",
    zh: "我想确认我们理解一致。",
    pattern: "be on the same page",
    note: "字面「在同一页上」，引申为理解一致。英语会议里最常见的固定表达之一，用来确认双方没有理解偏差。",
  },

  // ── 情绪表达 ──
  {
    id: "c36",
    scene: "情绪表达",
    en: "I'm honestly at a loss here.",
    zh: "我真的有点不知所措。",
    pattern: "be at a loss",
    note: "at a loss 是固定搭配，介词只能用 at，不能说 in a loss。honestly 表示「说实话」，让示弱显得真诚而不是抱怨。",
  },
  {
    id: "c37",
    scene: "情绪表达",
    en: "That took a weight off my mind.",
    zh: "这下我心里踏实了。",
    pattern: "take a weight off one's mind",
    note: "把心事比作压在心上的重量，拿走就轻松了——中文「心里的石头落地」是同一个比喻。用于别人替你解决了担心的事。",
  },
  {
    id: "c38",
    scene: "情绪表达",
    en: "I've been meaning to bring this up.",
    zh: "这件事我一直想提。",
    pattern: "have been meaning to + 动词原形",
    note: "mean to do 是「打算做」，用现在完成进行时表示「一直想做但还没做」。bring up 是「提起某话题」。用来开启一个憋了很久的话头。",
  },
  {
    id: "c39",
    scene: "情绪表达",
    en: "It's been weighing on me for a while.",
    zh: "这事压在我心里有阵子了。",
    pattern: "weigh on sb",
    note: "weigh on 是「压在心头」，主语是那件烦心事而不是人。比 I'm stressed 更具体地指明压力来源。",
  },
  {
    id: "c40",
    scene: "情绪表达",
    en: "I can't thank you enough for this.",
    zh: "这件事真是太感谢你了。",
    pattern: "can't + 动词 + enough",
    note: "字面「我怎么谢你都不够」，用否定表达最高程度——英语里常见的反向加强手法。分量比 Thank you very much 重得多。",
  },

  // ── 日常寒暄 ──
  {
    id: "c41",
    scene: "日常寒暄",
    en: "How's everything been on your end?",
    zh: "你那边一切都还好吗？",
    pattern: "on your end + 现在完成时",
    note: "用 has been 而不是 is，表示「从上次联系到现在这一段」。比 How are you 更适合久未联系的人，显得你记得上次。",
  },
  {
    id: "c42",
    scene: "日常寒暄",
    en: "What have you been up to lately?",
    zh: "你最近都在忙什么？",
    pattern: "be up to sth",
    note: "be up to 是「在忙什么、在搞什么」。现在完成进行时对应「最近这一阵」。语气轻松，朋友之间的标准开场白。",
  },
  {
    id: "c43",
    scene: "日常寒暄",
    en: "It's been ages since we last talked.",
    zh: "我们好久没聊了。",
    pattern: "It's been + 时间 + since + 过去式",
    note: "固定句型：主句用现在完成时，since 从句必须用一般过去时。ages 是夸张说法（好久好久），不是字面的很多年。",
  },
  {
    id: "c44",
    scene: "日常寒暄",
    en: "I heard about that, how did it go?",
    zh: "我听说了，后来怎么样？",
    pattern: "How did it go?",
    note: "go 在这里是「进展如何」。问结果的万能句，面试、考试、约会之后都能用。hear about sth 是「听说某事」。",
  },
  {
    id: "c45",
    scene: "日常寒暄",
    en: "Long story short, it didn't work out.",
    zh: "长话短说，没成。",
    pattern: "Long story short, …",
    note: "用来跳过细节直接给结论。work out 是「顺利、成功」，主语是事情本身。整句常带一点自嘲的味道。",
  },

  // ── 处理事情 ──
  {
    id: "c46",
    scene: "处理事情",
    en: "It's not as complicated as it sounds.",
    zh: "没听起来那么复杂。",
    pattern: "not as + 形容词 + as…",
    note: "as…as 是同级比较，加 not 就成了「不如…那么」。as it sounds 是「像听起来那样」，用来安抚被难住的人。",
  },
  {
    id: "c47",
    scene: "处理事情",
    en: "Let's play it by ear.",
    zh: "我们看情况再说。",
    pattern: "play it by ear",
    note: "来自音乐——不看谱、凭耳朵即兴演奏，引申为「不定死计划，见机行事」。固定短语，it 不能换成别的词。",
  },
  {
    id: "c48",
    scene: "处理事情",
    en: "I'll take care of it first thing tomorrow.",
    zh: "明天一早我就处理。",
    pattern: "first thing + 时间",
    note: "first thing tomorrow 是「明天头一件事」，前面不加介词，不说 at first thing。take care of 在这里是「处理」，不是「照顾」。",
  },
  {
    id: "c49",
    scene: "处理事情",
    en: "That's easier said than done.",
    zh: "说起来容易做起来难。",
    pattern: "easier said than done",
    note: "省略结构，完整意思是「被说出来比被做出来容易」。用来指出建议不切实际，语气比直接反驳温和得多。",
  },
  {
    id: "c50",
    scene: "处理事情",
    en: "We'll deal with that when it comes up.",
    zh: "到时候再说吧。",
    pattern: "when 引导的时间状语从句",
    note: "关键考点：时间状语从句里用一般现在时代替将来时——是 comes 而不是 will come。这是英语的硬规则，考试和口语都常错。",
  },

  // ── 学习理解 ──
  {
    id: "c51",
    scene: "学习理解",
    en: "I'm still getting the hang of it.",
    zh: "我还在慢慢上手。",
    pattern: "get the hang of sth",
    note: "get the hang of 是「摸到窍门」。用进行时 getting 强调还在过程中。承认不熟练但正在进步，不显得无能。",
  },
  {
    id: "c52",
    scene: "学习理解",
    en: "It finally clicked for me.",
    zh: "我终于想通了。",
    pattern: "sth clicks (for sb)",
    note: "click 本义是「咔哒一声」，引申为忽然贯通——像开关合上那一下。主语是那件事，不是人。",
  },
  {
    id: "c53",
    scene: "学习理解",
    en: "Could you put that in simpler terms?",
    zh: "能说得再简单点吗？",
    pattern: "put sth in + 形容词 + terms",
    note: "put 在这里是「表述」，terms 是「措辞」。请人说人话的礼貌版——把问题落在表述上，比 I don't understand 更有建设性。",
  },
  {
    id: "c54",
    scene: "学习理解",
    en: "I must have missed that part.",
    zh: "那部分我一定是漏了。",
    pattern: "must have + 过去分词",
    note: "must have done 是「对过去的肯定推测」，不是「必须」。推测三兄弟：must have（一定是）/ might have（可能是）/ can't have（不可能是）。",
  },
  {
    id: "c55",
    scene: "学习理解",
    en: "Give me a second to think this through.",
    zh: "让我缓一下捋清楚。",
    pattern: "think sth through",
    note: "through 表示「从头到尾彻底地」，think through 是想周全，区别于 think about（只是想想）。a second 同 a minute，都指一小会儿。",
  },
  {
    id: "c56",
    scene: "学习理解",
    en: "That makes a lot more sense now.",
    zh: "现在清楚多了。",
    pattern: "make sense",
    note: "make sense 是「讲得通」，主语是话或事，不是人——不能说 I make sense。a lot 用来加强比较级 more。",
  },
  {
    id: "c57",
    scene: "学习理解",
    en: "It's worth keeping in mind.",
    zh: "这点值得记住。",
    pattern: "be worth + 动名词",
    note: "worth 后面只能接动名词，不能接不定式，不说 worth to keep。keep sth in mind 是「记在心里」。整句提醒但不强求。",
  },
  {
    id: "c58",
    scene: "学习理解",
    en: "I'd appreciate it if you could let me know.",
    zh: "你能告诉我我会很感激。",
    pattern: "I'd appreciate it if + 从句",
    note: "这里的 it 不能省——appreciate 需要宾语，if 从句只是补充说明它。配合 would + could，是相当正式客气的请求。",
  },
  {
    id: "c59",
    scene: "学习理解",
    en: "Feel free to reach out anytime.",
    zh: "随时联系我。",
    pattern: "feel free to + 动词原形",
    note: "feel free to 是「尽管去做，别客气」。reach out 是主动联系，近年比 contact 更常用，语气更亲和。",
  },
  {
    id: "c60",
    scene: "学习理解",
    en: "I'll look into it and let you know.",
    zh: "我去查一下再告诉你。",
    pattern: "look into sth",
    note: "look into 是「调查、深入了解」，比 look at（只是看一眼）更进一步。接到问题后的标准回应：先查，再回复。",
  },
]

export const CORPUS_SCENES = [...new Set(SENTENCE_CORPUS.map((s) => s.scene))]
