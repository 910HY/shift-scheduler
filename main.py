# main.py
print("Starting main.py...")
import os
import logging
from flask import Flask, request, jsonify, send_from_directory

# 嘗試導入排班核心邏輯
try:
    from backend_api import ShiftSchedulerWithConstraints
except ImportError:
    ShiftSchedulerWithConstraints = None
    logging.error("關鍵錯誤：無法從 backend_api.py 導入 ShiftSchedulerWithConstraints。")
    logging.error("請確保 backend_api.py 文件存在於同級目錄，且包含 ShiftSchedulerWithConstraints 類。")

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = os.environ.get("SESSION_SECRET", "please_change_this_default_secret_key")

@app.route('/')
def index():
    logger.debug("請求根路徑 /，嘗試提供 index.html")
    try:
        return send_from_directory('.', 'index.html')
    except FileNotFoundError:
        logger.error("index.html 未在項目根目錄找到。")
        return "主頁文件 (index.html) 未找到。", 404
    except Exception as e:
         logger.error(f"提供 index.html 時發生錯誤: {e}", exc_info=True)
         return "加載主頁時出錯。", 500

@app.route('/schedule', methods=['POST'])
def create_schedule_api():
    logger.info(f"收到 /schedule 的 POST 請求")
    try:
        data = request.get_json()
        if not data:
            logger.warning("請求體為空或非 JSON 格式")
            return jsonify({"error": "請求體為空或非JSON格式"}), 400
        logger.debug(f"接收到的請求數據: {data}")

        # 提取參數
        k_employees_raw = data.get('k_employees')
        schedule_period = data.get('schedule_period')
        job_reqs_raw = data.get('job_requirements')
        max_consecutive_minutes_raw = data.get('max_consecutive_work_minutes')
        
        # 新增：獲取 rest_duration_minutes_after_work
        rest_duration_minutes_after_work_raw = data.get('rest_duration_minutes_after_work')

        enable_mandatory_break = data.get('enable_mandatory_break', False)
        designated_global_break_period = data.get('designated_global_break_period') # 注意拼寫，之前可能是 break_period
        min_mandatory_break_minutes_raw = data.get('min_mandatory_break_minutes')

        # --- 參數驗證 ---
        # 1. 檢查必需參數是否存在
        required_keys = [
            "k_employees", "schedule_period", "job_requirements",
            "max_consecutive_work_minutes", "rest_duration_minutes_after_work"
        ]
        missing_params = [key for key in required_keys if data.get(key) is None]
        if missing_params:
            msg = f"缺少必要的參數: {', '.join(missing_params)}"
            logger.warning(msg)
            return jsonify({"error": msg}), 400

        # 2. 類型轉換和值驗證 - k_employees
        try:
            k_employees = int(k_employees_raw)
            if k_employees <= 0:
                raise ValueError("員工人數必須大於0")
        except (ValueError, TypeError):
            msg = f"參數類型或數值錯誤: k_employees ('{k_employees_raw}') 必須是有效的正整數。"
            logger.warning(msg)
            return jsonify({"error": msg}), 400

        # 3. 類型轉換和值驗證 - max_consecutive_work_minutes
        try:
            max_consecutive_minutes = int(max_consecutive_minutes_raw)
            if max_consecutive_minutes <= 0:
                raise ValueError("最大連續工作時間必須大於0")
        except (ValueError, TypeError):
            msg = f"參數類型或數值錯誤: max_consecutive_work_minutes ('{max_consecutive_minutes_raw}') 必須是有效的正整數。"
            logger.warning(msg)
            return jsonify({"error": msg}), 400

        # 4. 類型轉換和值驗證 - rest_duration_minutes_after_work
        try:
            rest_duration_minutes_after_work = int(rest_duration_minutes_after_work_raw)
            if rest_duration_minutes_after_work not in [30, 60]:
                raise ValueError("rest_duration_minutes_after_work 參數值必須是 30 或 60。")
        except (ValueError, TypeError):
            msg = f"參數類型或數值錯誤: rest_duration_minutes_after_work ('{rest_duration_minutes_after_work_raw}') 必須是有效的整數 (30 或 60)。"
            logger.warning(msg)
            return jsonify({"error": msg}), 400
            
        # 5. 驗證 job_requirements 格式
        if not isinstance(job_reqs_raw, list):
            msg = "job_requirements 參數必須是一個包含字符串的列表。"
            logger.warning(msg)
            return jsonify({"error": msg}), 400
        # 可以添加更詳細的 job_reqs_raw 內部格式驗證 (如果需要)

        # 6. 強制落場相關參數驗證 (僅當啟用時)
        min_mandatory_break_minutes = 0 # 默認值
        if enable_mandatory_break:
            if not designated_global_break_period: # 檢查是否為空或 None
                msg = "啟用強制落場時，必須提供全局落場時段 (designated_global_break_period)。"
                logger.warning(msg)
                return jsonify({"error": msg}), 400
            if min_mandatory_break_minutes_raw is None:
                msg = "啟用強制落場時，必須提供最小落場休息時間 (min_mandatory_break_minutes)。"
                logger.warning(msg)
                return jsonify({"error": msg}), 400
            try:
                min_mandatory_break_minutes = int(min_mandatory_break_minutes_raw)
                if min_mandatory_break_minutes <= 0:
                    raise ValueError("最小落場休息時間必須大於0")
            except (ValueError, TypeError):
                msg = f"參數類型或數值錯誤: min_mandatory_break_minutes ('{min_mandatory_break_minutes_raw}') 必須是有效的正整數。"
                logger.warning(msg)
                return jsonify({"error": msg}), 400
        else:
            designated_global_break_period = "" # 如果未啟用，確保傳遞空字符串

        # --- 實例化排班器並求解 ---
        if ShiftSchedulerWithConstraints is None:
            logger.error("ShiftSchedulerWithConstraints 類未成功導入 (backend_api.py 問題?)")
            return jsonify({"error": "排班核心組件加載失敗，無法執行排班。"}), 500

        try:
            logger.debug("實例化 ShiftSchedulerWithConstraints...")
            scheduler = ShiftSchedulerWithConstraints(
                K_employees=k_employees, # 使用已驗證和轉換的變量名
                schedule_period_str=schedule_period,
                job_requirements_raw=job_reqs_raw,
                max_consecutive_work_minutes=max_consecutive_minutes,
                rest_duration_minutes_after_work=rest_duration_minutes_after_work, # 新參數
                enable_mandatory_break=enable_mandatory_break,
                designated_global_break_period_str=designated_global_break_period,
                min_mandatory_break_minutes=min_mandatory_break_minutes
            )
            logger.info("開始求解排班...")
            solution_grid, report = scheduler.solve()
            logger.info(f"排班求解完成，狀態: {report.get('status', '未知')}")

        except ValueError as ve:
            logger.error(f"排班器初始化或數據解析時出錯: {ve}", exc_info=True)
            return jsonify({"error": f"輸入數據處理錯誤: {ve}"}), 400
        except ImportError as ie:
            logger.error(f"缺少必要的庫: {ie}", exc_info=True)
            return jsonify({"error": f"服務器缺少必要的庫 ({ie})，無法執行排班。"}), 500
        except Exception as e:
            logger.error(f"排班求解過程中發生未知錯誤: {type(e).__name__} - {e}", exc_info=True)
            return jsonify({"error": f"排班求解過程中發生意外錯誤: {type(e).__name__}"}), 500

        # --- 返回結果 ---
        logger.debug("排班完成，準備返回結果")
        return jsonify({
            "solution_grid": solution_grid,
            "report": report
        })

    except Exception as e:
        logger.error(f"處理 /schedule 請求時發生頂層錯誤: {type(e).__name__} - {e}", exc_info=True)
        return jsonify({"error": "服務器內部錯誤，無法處理您的請求。"}), 500

# --- 用於運行的入口點 ---
if __name__ == '__main__':
    # 這部分主要用於本地開發
    # 生產環境會通過 Procfile 和 Gunicorn/Waitress 啟動
    logger.info("啟動 Flask 開發服務器 (僅供本地)...")
    # 在生產環境部署時，app.run 不應該被調用
    # 如果擔心誤調用，可以在部署前註釋掉或移除 app.run
    # 或者保持原樣，因為 Gunicorn 不會執行這個 __main__ 塊
    app.run(host='0.0.0.0', port=8080, debug=False) # 本地開發時 debug 可以是 True