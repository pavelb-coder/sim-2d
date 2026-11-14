<?php
// Смоук-тест плагина mod_lasercutstudio на живом Moodle (только CLI).
//
// Проверяет: создание экземпляра, элемент журнала, сохранение и пересдачу макета,
// файлы в filearea, оценку и попадание её в журнал,Privacy API, события в логе,
// резервное копирование/восстановление курса и удаление экземпляра.
//
// Запуск (из корня Moodle или откуда угодно):
//   php -d max_input_vars=5000 scripts/moodle-smoke.php --moodleroot=/var/www/moodle
//
// Плагин должен быть установлен в mod/lasercutstudio и upgrade.php уже выполнен.

define('CLI_SCRIPT', true);

$options = getopt('', ['moodleroot:', 'keep', 'help']);
if (isset($options['help']) || empty($options['moodleroot'])) {
    echo "Использование: php scripts/moodle-smoke.php --moodleroot=/путь/к/moodle [--keep]\n";
    echo "  --keep  не удалять созданные курсы после теста\n";
    exit(isset($options['help']) ? 0 : 1);
}

$moodleroot = rtrim($options['moodleroot'], '/');
if (!is_file($moodleroot . '/config.php')) {
    fwrite(STDERR, "Не найден $moodleroot/config.php — укажите корень установленного Moodle.\n");
    exit(1);
}
require($moodleroot . '/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->libdir . '/gradelib.php');
require_once($CFG->dirroot . '/backup/util/includes/backup_includes.php');
require_once($CFG->dirroot . '/backup/util/includes/restore_includes.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/lib.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/classes/submission.php');

// ---------------------------------------------------------------------------
// Каркас отчёта
// ---------------------------------------------------------------------------
$results = [];
$createdcourses = [];

function smoke_check(string $name, bool $pass, string $extra = ''): void {
    global $results;
    $results[] = [$name, $pass, $extra];
}

function smoke_course(string $fullname): stdClass {
    global $createdcourses;
    $course = create_course((object) [
        'fullname' => $fullname . ' ' . date('His'),
        'shortname' => 'lcxsmoke' . time() . mt_rand(100, 999),
        'category' => 1,
        'format' => 'topics',
    ]);
    $createdcourses[] = $course->id;
    return $course;
}

function smoke_add_activity(stdClass $course, string $name, int $grade = 100): array {
    global $DB;
    $module = $DB->get_record('modules', ['name' => 'lasercutstudio'], '*', MUST_EXIST);
    $instanceid = lasercutstudio_add_instance((object) [
        'course' => $course->id,
        'name' => $name,
        'intro' => '<p>Нарисуйте макет.</p>',
        'introformat' => FORMAT_HTML,
        'editorheight' => 640,
        'openinnewtab' => 0,
        'grade' => $grade,
    ]);
    // Moodle требует полный набор полей course_modules, иначе context_module::instance() падает.
    $cmid = add_course_module((object) [
        'course' => $course->id,
        'module' => $module->id,
        'instance' => $instanceid,
        'section' => 1,
        'visible' => 1,
        'idnumber' => '',
        'groupmode' => 0,
        'groupingid' => 0,
        'completion' => 0,
        'added' => time(),
        'score' => 0,
        'indent' => 0,
        'visibleoncoursepage' => 1,
        'visibleold' => 1,
        'completionview' => 0,
        'completionexpected' => 0,
        'showdescription' => 0,
        'deletioninprogress' => 0,
    ]);
    course_add_cm_to_section($course, $cmid, 1);
    return [$instanceid, $cmid];
}

$admin = get_admin();
$USER = $admin;
\core\session\manager::set_user($admin);
$fs = get_file_storage();

echo "Смоук-тест mod_lasercutstudio ({$CFG->release})\n\n";

// ---------------------------------------------------------------------------
// 1. Экземпляр модуля и элемент журнала
// ---------------------------------------------------------------------------
$course = smoke_course('Смоук-тест лазерной резки');
[$instanceid, $cmid] = smoke_add_activity($course, 'Корпус из фанеры');
$context = context_module::instance($cmid);
$instance = $DB->get_record('lasercutstudio', ['id' => $instanceid], '*', MUST_EXIST);
smoke_check('экземпляр создан', $instanceid > 0, "id=$instanceid, cmid=$cmid");

$gradeitem = grade_item::fetch([
    'courseid' => $course->id,
    'itemtype' => 'mod',
    'itemmodule' => 'lasercutstudio',
    'iteminstance' => $instanceid,
]);
smoke_check('элемент журнала создан', !empty($gradeitem), $gradeitem ? 'grademax=' . $gradeitem->grademax : 'нет');

// ---------------------------------------------------------------------------
// 2. Сохранение макета, файлы, пересдача
// ---------------------------------------------------------------------------
$project = json_encode([
    'schemaVersion' => 1,
    'order' => ['a', 'b', 'c', 'd'],
    'objects' => ['a' => ['id' => 'a'], 'b' => ['id' => 'b'], 'c' => ['id' => 'c'], 'd' => ['id' => 'd']],
    'sheets' => [['id' => 's1', 'width' => 300, 'height' => 200]],
]);
$submission = \mod_lasercutstudio\submission::save($instance, $context, $admin->id, $project, 'первая версия', 0);
smoke_check('save() создаёт запись', $submission && $submission->id > 0, 'status=' . $submission->status);
smoke_check('объекты посчитаны', $submission->objectcount == 4, 'objects=' . $submission->objectcount);
smoke_check('размер записан', $submission->filesize == strlen($project), 'bytes=' . $submission->filesize);

$files = \mod_lasercutstudio\submission::get_files($context, $admin->id);
smoke_check('макет лежит в filearea', count($files) === 1,
    implode(', ', array_map(fn($f) => $f->get_filename(), $files)));
$projectfile = \mod_lasercutstudio\submission::get_project_file($context, $admin->id);
smoke_check('get_project_file находит .lcx',
    $projectfile && $projectfile->get_filename() === $submission->filename);
smoke_check('содержимое файла совпадает', $projectfile && $projectfile->get_content() === $project);

sleep(1); // имя файла содержит метку времени
$project2 = str_replace('"d"', '"e"', $project);
$submission2 = \mod_lasercutstudio\submission::save($instance, $context, $admin->id, $project2, 'вторая версия', 0);
$files2 = \mod_lasercutstudio\submission::get_files($context, $admin->id);
smoke_check('пересдача обновляет запись', $submission2->id == $submission->id);
smoke_check('пересдача не плодит копии .lcx', count($files2) === 1,
    implode(', ', array_map(fn($f) => $f->get_filename(), $files2)));

// ---------------------------------------------------------------------------
// 3. Оценка
// ---------------------------------------------------------------------------
$graded = \mod_lasercutstudio\submission::set_grade($instance, $context, $submission2, 87.5);
smoke_check('оценка записана в сдачу', (float) $graded->grade === 87.5, 'grade=' . $graded->grade);
smoke_check('status = graded', $graded->status === \mod_lasercutstudio\submission::STATUS_GRADED);
$grade = grade_get_grades($course->id, 'mod', 'lasercutstudio', $instanceid, [$admin->id]);
$rawgrade = $grade->items[0]->grades[$admin->id]->grade ?? null;
smoke_check('оценка попала в журнал',
    $rawgrade !== null && abs((float) $rawgrade - 87.5) < 0.01, 'grade=' . var_export($rawgrade, true));

// ---------------------------------------------------------------------------
// 4. Privacy API и события
// ---------------------------------------------------------------------------
$collection = new \core_privacy\local\metadata\collection('mod_lasercutstudio');
$collection = \mod_lasercutstudio\privacy\provider::get_metadata($collection);
smoke_check('privacy: метаданные собираются', count($collection->get_collection()) >= 3,
    'элементов=' . count($collection->get_collection()));

$events = $DB->get_records('logstore_standard_log', ['component' => 'mod_lasercutstudio'], 'id ASC', 'id, action');
$actions = array_values(array_map(fn($e) => $e->action, $events));
smoke_check('события пишутся в лог', count($events) >= 3, implode(', ', $actions));

// ---------------------------------------------------------------------------
// 5. Резервное копирование и восстановление курса
// ---------------------------------------------------------------------------
$bc = new backup_controller(backup::TYPE_1COURSE, $course->id, backup::FORMAT_MOODLE,
    backup::INTERACTIVE_NO, backup::MODE_GENERAL, $admin->id);
$bc->get_plan()->get_setting('users')->set_value(true);
$bc->execute_plan();
$backupresult = $bc->get_results();
$backupfile = $backupresult['backup_destination'] ?? null;
smoke_check('резервная копия создана', !empty($backupfile), $backupfile ? $backupfile->get_filename() : 'нет');
$bc->destroy();

$restoredid = 0;
if ($backupfile) {
    $backupdir = restore_controller::get_tempdir_name(SITEID, $admin->id);
    $tempdir = make_backup_temp_directory($backupdir);
    get_file_packer('application/vnd.moodle.backup')->extract_to_pathname($backupfile, $tempdir);
    [$fullname, $shortname] = restore_dbops::calculate_course_names(0, 'Восстановленный курс', 'restored');
    $restoredid = restore_dbops::create_new_course($fullname, $shortname, 1);
    $createdcourses[] = $restoredid;
    $rc = new restore_controller($backupdir, $restoredid, backup::INTERACTIVE_NO, backup::MODE_GENERAL,
        $admin->id, backup::TARGET_NEW_COURSE);
    $rc->execute_precheck();
    $rc->execute_plan();
    $rc->destroy();
    $backupfile->delete();

    $restoredmodules = $DB->get_records_sql(
        "SELECT cm.id, cm.instance
           FROM {course_modules} cm
           JOIN {modules} m ON m.id = cm.module
          WHERE cm.course = ? AND m.name = 'lasercutstudio'",
        [$restoredid]);
    smoke_check('модуль восстановлен в новом курсе', count($restoredmodules) === 1,
        'модулей=' . count($restoredmodules));
    if ($restoredmodules) {
        $restoredcm = reset($restoredmodules);
        $restoredsubs = $DB->get_records('lasercutstudio_submissions', ['lasercutstudioid' => $restoredcm->instance]);
        smoke_check('сдача восстановлена', count($restoredsubs) === 1, 'сдач=' . count($restoredsubs));
        if ($restoredsubs) {
            $restoredsub = reset($restoredsubs);
            $restoredctx = context_module::instance($restoredcm->id);
            $restoredfile = \mod_lasercutstudio\submission::get_project_file($restoredctx, $restoredsub->userid);
            smoke_check('файл макета восстановлен', !empty($restoredfile),
                $restoredfile ? $restoredfile->get_filename() : 'нет');
            smoke_check('содержимое макета восстановлено',
                $restoredfile && $restoredfile->get_content() === $project2);
        }
    }
}

// ---------------------------------------------------------------------------
// 6. Удаление экземпляра чистит данные
// ---------------------------------------------------------------------------
$deleted = lasercutstudio_delete_instance($instanceid);
smoke_check('delete_instance вернул true', $deleted);
smoke_check('записи сдач удалены',
    $DB->count_records('lasercutstudio_submissions', ['lasercutstudioid' => $instanceid]) === 0);
smoke_check('файлы удалены',
    count($fs->get_area_files($context->id, 'mod_lasercutstudio', 'submission', $admin->id, 'id', false)) === 0);

// ---------------------------------------------------------------------------
// Уборка и отчёт
// ---------------------------------------------------------------------------
if (!isset($options['keep'])) {
    foreach ($createdcourses as $courseid) {
        if ($courseid && $DB->record_exists('course', ['id' => $courseid])) {
            delete_course($courseid, false);
        }
    }
}

$failed = 0;
foreach ($results as [$name, $pass, $extra]) {
    echo ($pass ? '  ✓ ' : '  ✗ ') . $name . ($extra !== '' ? " — $extra" : '') . "\n";
    if (!$pass) {
        $failed++;
    }
}
$total = count($results);
echo "\n" . ($total - $failed) . '/' . $total . " проверок пройдено\n";
exit($failed ? 1 : 0);
