// 节点拓展模型先作为持久化和接口契约前置，不要求当前单机链路立即消费所有类型。
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/** EncodeLab 主机内置节点 id，用于把现有本机路径纳入节点位置模型。 */
pub const LOCAL_NODE_ID: &str = "local";

/** 节点内文件位置。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileLocation {
    /** 文件所在节点；local 表示 EncodeLab 主机内置节点。 */
    pub node_id: String,
    /** 节点本机可访问的绝对路径。 */
    pub path: String,
}

impl FileLocation {
    /** 构建本机文件位置，用于兼容当前单机转码链路。 */
    pub fn local(path: impl Into<String>) -> Self {
        Self {
            node_id: LOCAL_NODE_ID.to_string(),
            path: path.into(),
        }
    }
}

/** 文件产物用途。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactRole {
    /** 原始输入文件。 */
    Input,
    /** 转码输出文件。 */
    Output,
    /** 预览帧或预览中间产物。 */
    Preview,
    /** 可清理的临时文件。 */
    Temp,
}

/** 输入、输出或中间产物的位置描述。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactLocation {
    /** 文件所在节点；local 表示 EncodeLab 主机内置节点。 */
    pub node_id: String,
    /** 节点本机可访问的绝对路径。 */
    pub path: String,
    /** 文件用途。 */
    pub role: ArtifactRole,
    /** 可选内容校验，用于跨节点复用和传输校验。 */
    #[serde(default)]
    pub checksum: Option<String>,
    /** 文件大小，单位 byte。 */
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

/** 节点类型。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    /** EncodeLab 主控所在机器的内置节点。 */
    Local,
    /** 独立 Node Agent 注册进来的远程节点。 */
    Remote,
}

/** 节点运行状态。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeStatus {
    /** 节点在线且可接收任务。 */
    Online,
    /** 节点只完成存量任务，不再接收新任务。 */
    Draining,
    /** 节点离线。 */
    Offline,
    /** 用户主动禁用节点。 */
    Disabled,
}

/** 节点转码槽位。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeSlots {
    /** 节点可并发执行的总槽位数。 */
    pub total: u16,
    /** 当前已占用槽位数。 */
    pub used: u16,
}

/** 节点上报的执行能力摘要。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeCapabilities {
    /** 节点 ffmpeg 版本。 */
    #[serde(default)]
    pub ffmpeg_version: Option<String>,
    /** 节点可用编码器列表。 */
    pub encoders: Vec<String>,
    /** 节点 GPU 描述。 */
    #[serde(default)]
    pub gpu: Vec<String>,
}

/** 节点能力和运行状态。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeDescriptor {
    /** 节点唯一标识。 */
    pub id: String,
    /** 用户可读名称。 */
    pub name: String,
    /** local 表示主控内置节点，remote 表示独立 Agent。 */
    pub kind: NodeKind,
    /** 节点 HTTP 入口；local 节点可为空。 */
    #[serde(default)]
    pub endpoint: Option<String>,
    /** 节点平台和架构描述。 */
    pub platform: String,
    /** 节点状态。 */
    pub status: NodeStatus,
    /** 节点可并发执行的转码槽位。 */
    pub slots: NodeSlots,
    /** ffmpeg、ffprobe、编码器和 GPU 能力摘要。 */
    pub capabilities: NodeCapabilities,
    /** 最近一次心跳时间。 */
    #[serde(default)]
    pub last_seen_at: Option<String>,
}

/** 跨节点文件传输方式。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransferMode {
    /** 节点之间直接传输。 */
    Direct,
    /** Controller 零落盘流式中转。 */
    Relay,
}

/** 传输任务状态。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    /** 等待调度。 */
    Queued,
    /** 正在传输。 */
    Running,
    /** 传输完成。 */
    Completed,
    /** 传输失败。 */
    Failed,
    /** 传输已取消。 */
    Canceled,
}

/** 跨节点文件传输计划。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferPlan {
    /** 传输任务 id。 */
    pub id: String,
    /** 源文件位置。 */
    pub source: FileLocation,
    /** 目标文件位置。 */
    pub target: FileLocation,
    /** 传输方式。 */
    pub mode: TransferMode,
    /** 当前状态。 */
    pub status: TransferStatus,
    /** 已传输字节数。 */
    #[serde(default)]
    pub transferred_bytes: Option<u64>,
    /** 失败原因。 */
    #[serde(default)]
    pub error: Option<String>,
}

/** 分布式转码任务状态。 */
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DistributedTaskStatus {
    /** 等待调度。 */
    Queued,
    /** 正在准备执行环境或文件。 */
    Preparing,
    /** 正在同步输入或归集输出。 */
    Transferring,
    /** 正在执行转码。 */
    Running,
    /** 转码完成。 */
    Completed,
    /** 转码失败且不可继续重试。 */
    Failed,
    /** 用户取消。 */
    Canceled,
}

/** 可调度的单个转码单元。 */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributedTask {
    /** 任务 id。 */
    pub id: String,
    /** 所属用户级 Job。 */
    pub job_id: String,
    /** 输入文件位置。 */
    pub input: ArtifactLocation,
    /** 输出文件位置。 */
    pub output: ArtifactLocation,
    /** 当前被分配的执行节点。 */
    #[serde(default)]
    pub assigned_node_id: Option<String>,
    /** 转码参数快照，后续可收敛为 TaskConfigPayload。 */
    pub task_config_snapshot: serde_json::Value,
    /** 运行状态。 */
    pub status: DistributedTaskStatus,
    /** 已尝试次数。 */
    pub attempt: u16,
}

/** 节点上报事件。 */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NodeEvent {
    /** 节点心跳。 */
    Heartbeat {
        /** 节点 id。 */
        node_id: String,
        /** 事件发生时间。 */
        at: String,
        /** 当前槽位状态。 */
        slots: NodeSlots,
    },
    /** 转码任务进度。 */
    TaskProgress {
        /** 节点 id。 */
        node_id: String,
        /** 任务 id。 */
        task_id: String,
        /** 百分比进度，范围 0..=100。 */
        progress: f64,
        /** 当前 fps。 */
        #[serde(default)]
        fps: Option<f64>,
        /** 当前 speed 倍速。 */
        #[serde(default)]
        speed: Option<f64>,
    },
    /** 文件传输进度。 */
    TransferProgress {
        /** 节点 id。 */
        node_id: String,
        /** 传输任务 id。 */
        transfer_id: String,
        /** 已传输字节数。 */
        transferred_bytes: u64,
    },
    /** 转码任务失败。 */
    TaskFailed {
        /** 节点 id。 */
        node_id: String,
        /** 任务 id。 */
        task_id: String,
        /** 失败原因。 */
        error: String,
    },
    /** 节点级错误。 */
    NodeError {
        /** 节点 id。 */
        node_id: String,
        /** 错误原因。 */
        error: String,
    },
}
