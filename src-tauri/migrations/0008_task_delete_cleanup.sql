CREATE TRIGGER IF NOT EXISTS work_items_cleanup_connections
BEFORE DELETE ON work_items
FOR EACH ROW
BEGIN
  UPDATE ai_sessions SET linked_work_item_id = NULL
  WHERE linked_work_item_id = OLD.id;

  DELETE FROM work_item_links
  WHERE work_item_id = OLD.id;
END;
