use serde::{Deserialize, Serialize};

use crate::models::node::FileLocation;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobHistory {
    pub id: String,
    pub task_id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub input_file: String,
    pub output_file: String,
    /** 输入文件节点位置；为空时按旧数据解释为 local + input_file。 */
    #[serde(default)]
    pub input_location: Option<FileLocation>,
    /** 输出文件节点位置；为空时按旧数据解释为 local + output_file。 */
    #[serde(default)]
    pub output_location: Option<FileLocation>,
    /** 本次任务实际执行节点；为空时按旧数据解释为 local。 */
    #[serde(default)]
    pub execution_node_id: Option<String>,
    /** 关联的文件传输任务 id，分布式调度启用后用于追踪同步和归集。 */
    #[serde(default)]
    pub transfer_ids: Vec<String>,
    /** 输入文件大小，单位字节；旧数据或读取失败时为空。 */
    #[serde(default)]
    pub input_size_bytes: Option<u64>,
    /** 输出文件大小，单位字节；仅任务成功且读取成功时记录。 */
    #[serde(default)]
    pub output_size_bytes: Option<u64>,
    /** 输出相对输入的体积变化百分比；负数表示变小，正数表示变大。 */
    #[serde(default)]
    pub size_change_percent: Option<f64>,
    /** 输入视频轨道大小，单位字节；优先来自 ffprobe stream tags，缺失时可估算。 */
    #[serde(default)]
    pub input_video_size_bytes: Option<u64>,
    /** 输出视频轨道大小，单位字节；优先来自 ffprobe stream tags，缺失时可估算。 */
    #[serde(default)]
    pub output_video_size_bytes: Option<u64>,
    /** 输出视频轨道相对输入视频轨道的体积变化百分比。 */
    #[serde(default)]
    pub video_size_change_percent: Option<f64>,
    pub status: String,
    #[serde(default)]
    pub command_line: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}
