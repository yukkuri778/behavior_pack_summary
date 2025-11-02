import { world, system } from "@minecraft/server";

// --- 定数定義 ---

// スコアボード名
const MINING_COUNT_OBJECTIVE = "mining_count"; // プレイヤーごとの採掘数
const WORLD_MINING_COUNT_OBJECTIVE = "world_mining"; // ワールド全体の統計

// ワールド統計用スコアボードの偽プレイヤー名
const WORLD_TOTAL_HOLDER = "world_total"; // ワールド全体の総採掘数

// Dynamic Property のプレフィックス
const BLOCK_COUNT_PREFIX = "block_count:"; // ブロックごとの採掘数
const ACTION_BAR_ENABLED_PROP = "actionBar:enabled"; // アクションバー表示設定

// コマンド用イベントID
const RANK_EVENT_ID = "gemini:rank";
const SUMMARY_EVENT_ID = "gemini:summary";
const RESET_EVENT_ID = "gemini:reset";

// リセット確認用の待機時間（ミリ秒）
const RESET_CONFIRMATION_TIMEOUT = 10000; // 10秒

// カウントしないブロックのリスト
const EXCLUDED_BLOCKS = new Set([
    "minecraft:air",
    "minecraft:grass",
    "minecraft:tall_grass",
    "minecraft:double_plant",
    "minecraft:fern",
    "minecraft:red_flower",
    "minecraft:yellow_flower",
    "minecraft:sapling",
    "minecraft:short_grass",
    "minecraft:deadbush",
    "minecraft:dandelion",
    "minecraft:vine",
    "minecraft:waterlily",
    "minecraft:web",
    "minecraft:brown_mushroom",
    "minecraft:red_mushroom",
    "minecraft:torch",
    "minecraft:redstone_torch",
    "minecraft:lever",
    "minecraft:leaf_litter",
    "minecraft:tripwire_hook",
    "minecraft:tripwire"
]);

// --- グローバル変数 ---

// リセット要求を管理するオブジェクト { playerId: timestamp }
let resetRequests = {};

// --- 初期化処理 ---

/**
 * ワールド初期化時にスコアボードを設定します。
 */
world.afterEvents.worldInitialize.subscribe(() => {
    // プレイヤーごとの採掘数スコアボード
    if (!world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE)) {
        world.scoreboard.addObjective(MINING_COUNT_OBJECTIVE, "採掘数");
    }

    // ワールド統計用スコアボード
    if (!world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE)) {
        world.scoreboard.addObjective(WORLD_MINING_COUNT_OBJECTIVE, "ワールド統計");
    }
});

// --- イベントリスナー ---

/**
 * プレイヤーが参加したときのイベントを処理します。
 */
world.afterEvents.playerJoin.subscribe(event => {
    const { player } = event;
    // アクションバー表示設定がまだない場合、デフォルトでONにする
    if (player.getDynamicProperty(ACTION_BAR_ENABLED_PROP) === undefined) {
        player.setDynamicProperty(ACTION_BAR_ENABLED_PROP, true);
    }
});

/**
 * プレイヤーがブロックを破壊したときのイベントを処理します。
 */
world.afterEvents.playerBreakBlock.subscribe(event => {
    const { player, brokenBlockPermutation } = event;
    const blockId = brokenBlockPermutation.type.id;

    // 除外リストに含まれるブロックはカウントしない
    if (EXCLUDED_BLOCKS.has(blockId)) {
        return;
    }

    // クリエイティブモードのプレイヤーはカウントしない
    try {
        const creativePlayers = world.getPlayers({ gameMode: "creative" });
        const isCreative = creativePlayers.some(p => p.id === player.id);
        if (isCreative) {
            return; // クリエイティブモードなら以降の処理をしない
        }
    } catch(e) {
        console.error(`[MiningRanking] Failed to check gamemodES: ${e}`);
        return; // 安全のため、エラー時もカウントしない
    }

    // 1. プレイヤーの採掘数を1増やす
    try {
        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        // スコアをインクリメントし、新しいスコアを取得
        const newScore = objective.addScore(player, 1);

        // お祝いの閾値リスト
        const CELEBRATION_MILESTONES = [100, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 40000, 50000];

        // スコアがリストに含まれているかチェック
        if (CELEBRATION_MILESTONES.includes(newScore)) {
            // お祝いメッセージ
            world.sendMessage(`§l§k!!!§r §b${player.name}§r が採掘数 §e${newScore}個§r を突破しました！ §k!!!§r`);
            // 花火を打ち上げる
            player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
            // 経験値取得音を全プレイヤーに再生
            world.playSound("random.pop", player.location, { volume: 0.8, pitch: 1.0, players: world.getAllPlayers() });
        }

        //以降１０万ごとにお祝い
        else if(newScore % 100000 == 0){ 
            world.sendMessage(`§l§k!!!§r §b${player.name}§r が採掘数 §e${newScore}個§r を突破しました！ §k!!!§r`);
            player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
            world.playSound("random.pop", player.location, { volume: 0.8, pitch: 1.0, players: world.getAllPlayers() });
        }
    } catch (e) {
        console.error(`[MiningRanking] Failed to add score to player ${player.name}: ${e}`);
    }

    // 2. ワールド全体の総採掘数を1増やす
    try {
        const objective = world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE);
        const newWorldScore = objective.addScore(WORLD_TOTAL_HOLDER, 1);

        // お祝いの閾値リスト
        const CELEBRATION_MILESTONES = [1000, 3000, 5000, 10000, 30000, 50000, 100000, 200000, 300000, 400000, 500000];

        // ワールドの総採掘数がリストに含まれているかチェック
        if (CELEBRATION_MILESTONES.includes(newWorldScore)) {
            // お祝いメッセージ
            world.sendMessage(`§l§k!!!§r §dワールド総採掘数§r が §e${newWorldScore}個§r に到達しました！ §k!!!§r`);
            // 全てのプレイヤーから花火を打ち上げる
            for (const p of world.getAllPlayers()) {
                p.dimension.spawnEntity("minecraft:fireworks_rocket", p.location);
            }
            // 経験値取得音を全プレイヤーに再生
            world.playSound("random.levelup", player.location, { volume: 1.0, pitch: 0.8, players: world.getAllPlayers() });
        }

        //以降１００万ごとにお祝い
        else if(newWorldScore % 1000000 == 0){
            world.sendMessage(`§l§k!!!§r §dワールド総採掘数§r が §e${newWorldScore}個§r に到達しました！ §k!!!§r`);
            for (const p of world.getAllPlayers()) {
                p.dimension.spawnEntity("minecraft:fireworks_rocket", p.location);
            }
            world.playSound("random.levelup", player.location, { volume: 1.0, pitch: 0.8, players: world.getAllPlayers() });
        }

    } catch (e) {
        console.error(`[MiningRanking] Failed to add score to world total: ${e}`);
    }

    // 3. ブロックごとの採掘数をカウント
    const propId = `${BLOCK_COUNT_PREFIX}${blockId}`;
    const currentBlockCount = world.getDynamicProperty(propId);
    if (typeof currentBlockCount === 'number') {
        world.setDynamicProperty(propId, currentBlockCount + 1);
    } else {
        world.setDynamicProperty(propId, 1);
    }
});

/**
 * functionコマンドから送られたイベントを処理します。
 */
system.afterEvents.scriptEventReceive.subscribe(event => {
    const { id, sourceEntity } = event;

    // 実行者がプレイヤーでない場合は処理しない
    if (!sourceEntity || sourceEntity.typeId !== 'minecraft:player') return;

    if (id === RANK_EVENT_ID) {
        showRank(sourceEntity);
    } else if (id === SUMMARY_EVENT_ID) {
        showSummary(sourceEntity);
    } else if (id === RESET_EVENT_ID) {
        handleResetRequest(sourceEntity);
    }
});

/**
 * プレイヤーがアイテムを使用したときのイベントを処理します。
 */
world.afterEvents.itemUse.subscribe(event => {
    const { source, itemStack } = event;
    if (source.typeId !== 'minecraft:player') return;

    // コンパス使用でランキング表示
    if (itemStack.typeId === 'minecraft:compass') {
        system.run(() => {
            showRank(source);
        });
    } 
    // 時計使用でアクションバー表示を切り替え
    else if (itemStack.typeId === 'minecraft:clock') {
        const currentStatus = source.getDynamicProperty(ACTION_BAR_ENABLED_PROP);
        // undefined (初回) または true なら false に、false なら true に切り替える
        const newStatus = !(currentStatus ?? true);
        source.setDynamicProperty(ACTION_BAR_ENABLED_PROP, newStatus);

        if (newStatus) {
            source.sendMessage("§aアクションバーのランキング表示をONにしました。");
        } else {
            source.sendMessage("§cアクションバーのランキング表示をOFFにしました。");
            // OFFにした直後にアクションバーをクリアする
            source.onScreenDisplay.setActionBar("");
        }
    }
});


// --- 定期実行処理 ---

/**
 * 1秒ごとに各プレイヤーのアクションバーを更新します。
 */
system.runInterval(() => {
    try {
        const players = world.getAllPlayers();
        if (players.length === 0) return;

        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        if (!objective) return;

        // 全プレイヤーのスコアを取得し、ランキングを生成
        const allScores = objective.getScores().map(score => ({
            name: score.participant.displayName,
            score: score.score
        }));
        allScores.sort((a, b) => b.score - a.score);

        // 各プレイヤーの情報を更新
        for (const player of players) {
            // アクションバー表示がOFFのプレイヤーはスキップ
            if (player.getDynamicProperty(ACTION_BAR_ENABLED_PROP) === false) {
                continue;
            }

            const myScore = objective.getScore(player) ?? 0;
            const myRank = allScores.findIndex(s => s.name === player.name) + 1;

            let nextRankInfo = "---";
            if (myRank > 1) {
                const nextRankScore = allScores[myRank - 2].score;
                const diff = nextRankScore - myScore + 1;
                nextRankInfo = `次の順位まで：${diff}個`;
            } else if (allScores.length > 1) {
                nextRankInfo = "次の順位まで：現在1位！";
            } else {
                nextRankInfo = "独走中！";
            }

            const message = `§e採掘数: §f${myScore}個 §7| §e順位: §f${myRank}位 §7| §e${nextRankInfo}`;
            player.onScreenDisplay.setActionBar(message);
        }
    } catch (e) {
        console.error(`[MiningRanking] Error in action bar update loop: ${e}`);
    }
}, 20); // 20 ticks = 1秒


// --- コマンド処理関数 ---

/**
 * 採掘数ランキングをプレイヤーに表示します。
 * @param {import("@minecraft/server").Player} player
 */
function showRank(player) {
    try {
        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        if (!objective) {
            player.sendMessage("§cランキングデータを取得できませんでした。");
            return;
        }

        const scores = objective.getScores();
        scores.sort((a, b) => b.score - a.score);

        player.sendMessage("§l§b--- 採掘数ランキング TOP10 ---");

        // 上位10名を表示
        const top10 = scores.slice(0, 10);
        top10.forEach((entry, index) => {
            player.sendMessage(`§e${index + 1}位: §f${entry.participant.displayName} §7- §r${entry.score}個`);
        });

        player.sendMessage("§b--------------------");

        // 実行者の順位を表示
        const myScore = objective.getScore(player) ?? 0;
        const myRank = scores.findIndex(s => s.participant.displayName === player.name) + 1;

        if (myRank > 0) {
            player.sendMessage(`§aあなたの順位: ${myRank}位 (${myScore}個)`);
        } else {
            player.sendMessage("§aあなたはまだランク外です。");
        }
    } catch (e) {
        player.sendMessage("§cランキングの表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showRank: ${e}`);
    }
}

/**
 * ワールド全体の採掘統計をプレイヤーに表示します。
 * @param {import("@minecraft/server").Player} player
 */
function showSummary(player) {
    try {
        // 1. ワールド全体の総採掘数を取得
        const worldObjective = world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE);
        const totalMined = worldObjective?.getScore(WORLD_TOTAL_HOLDER) ?? 0;

        player.sendMessage("§l§b--- ワールド採掘統計 ---");
        player.sendMessage(`§e総採掘数: §f${totalMined}個`);
        player.sendMessage("§b--------------------");


        // 2. ブロックごとの採掘数を取得
        const allProperties = world.getDynamicPropertyIds();
        const blockCounts = [];
        for (const propId of allProperties) {
            if (propId.startsWith(BLOCK_COUNT_PREFIX)) {
                const blockId = propId.substring(BLOCK_COUNT_PREFIX.length);
                const count = world.getDynamicProperty(propId);
                if (typeof count === 'number') {
                    blockCounts.push({ id: blockId, count: count });
                }
            }
        }

        // 採掘数でソート
        blockCounts.sort((a, b) => b.count - a.count);

        player.sendMessage("§l§b--- ブロック別採掘数 TOP10 ---");

        if (blockCounts.length === 0) {
            player.sendMessage("§eまだブロックは採掘されていません。");
            return;
        }

        // 上位10件を表示
        const top10 = blockCounts.slice(0, 10);
        top10.forEach((block, index) => {
            // "minecraft:" プレフィックスを削除して表示
            const displayName = block.id.replace("minecraft:", "");
            player.sendMessage(`§e${index + 1}位: §f${displayName} §7- §r${block.count}個`);
        });
        player.sendMessage("§b--------------------");

    } catch (e) {
        player.sendMessage("§c統計の表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showSummary: ${e}`);
    }
}

/**
 * データリセット要求を処理します。
 * @param {import("@minecraft/server").Player} player
 */
function handleResetRequest(player) {
    const now = Date.now();
    const lastRequestTime = resetRequests[player.id];

    if (lastRequestTime && (now - lastRequestTime) < RESET_CONFIRMATION_TIMEOUT) {
        // 10秒以内に再実行された場合
        executeReset();
        world.sendMessage(`§l§c[System] ${player.name} によってすべてのデータがリセットされました。`);
        world.playSound("random.anvil_land", player.location, { volume: 0.8, pitch: 1.0, players: world.getAllPlayers() });
        delete resetRequests[player.id]; // 正常にリセットされたのでタイムアウトをキャンセルするために削除
    } else {
        // 初回実行またはタイムアウト後の実行の場合
        resetRequests[player.id] = now;
        player.sendMessage("§c§l[System]警告: 本当にすべての採掘データをリセットしますか？");
        player.sendMessage(`§cこの操作は取り消せません。実行するには、${RESET_CONFIRMATION_TIMEOUT / 1000}秒以内にもう一度 /function reset を実行してください。`);

        // タイムアウト処理を設定
        system.runTimeout(() => {
            // タイムアウト後にまだリセット要求が存在するか確認
            if (resetRequests[player.id] === now) {
                player.sendMessage("§e[System]データリセットがキャンセルされました。");
                delete resetRequests[player.id];
            }
        }, RESET_CONFIRMATION_TIMEOUT / 1000 * 20); // 秒数をtickに変換 (20 ticks/sec)
    }
}

/**
 * すべてのランキングデータをリセットします。
 */
function executeReset() {
    try {
        // 1. プレイヤーごとの採掘数をリセット
        const miningObjective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        if (miningObjective) {
            for (const participant of miningObjective.getParticipants()) {
                miningObjective.removeParticipant(participant);
            }
        }

        // 2. ワールド全体の採掘数をリセット
        const worldObjective = world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE);
        if (worldObjective) {
            worldObjective.setScore(WORLD_TOTAL_HOLDER, 0);
        }

        // 3. ブロックごとの採掘数をリセット
        const allProperties = world.getDynamicPropertyIds();
        for (const propId of allProperties) {
            if (propId.startsWith(BLOCK_COUNT_PREFIX)) {
                world.setDynamicProperty(propId, undefined);
            }
        }
        console.log("[MiningRanking] All data has been reset.");
    } catch (e) {
        console.error(`[MiningRanking] Failed to execute reset: ${e}`);
        world.sendMessage("§cデータのリセット中にエラーが発生しました。");
    }
}