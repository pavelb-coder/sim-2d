<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Russian strings for the LaserCut Studio activity module.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['attachment'] = 'Файлы макета';
$string['attachment_help'] = 'Необязательно: приложите проект .lcx или выгруженные DXF/SVG. Файл, созданный кнопкой «Сдать в Moodle» внутри редактора, прикрепляется автоматически.';
$string['comment'] = 'Комментарий';
$string['downloadproject'] = 'Скачать макет';
$string['editorheight'] = 'Высота редактора, px';
$string['editorheight_help'] = 'Высота встроенного редактора в пикселях. Для большинства экранов подходит 600–900 px; кнопка «На весь экран» открывает редактор в отдельной вкладке.';
$string['editormissing'] = 'Не найдена сборка редактора';
$string['editormissing_details'] = 'Скопируйте собранный редактор в moodle/mod/lasercutstudio/editor/index.html (см. README в папке плагина).';
$string['editorheighterror'] = 'Высота должна быть от 320 до 2160 px.';
$string['editorsettings'] = 'Редактор';
$string['event_submission_created'] = 'Макет сдан';
$string['event_submission_graded'] = 'Макет оценён';
$string['fullscreen'] = 'На весь экран';
$string['grade_help'] = 'Если задан максимальный балл, преподаватель может оценивать сданные макеты. Оценка попадает в журнал оценок курса.';
$string['grades'] = 'Оценки';
$string['graded'] = 'Оценено';
$string['gradedby'] = 'Оценил';
$string['lasercutstudio:addinstance'] = 'Добавлять задание «LaserCut Studio»';
$string['lasercutstudio:downloadsubmission'] = 'Скачивать сданные макеты';
$string['lasercutstudio:grade'] = 'Оценивать сданные макеты';
$string['lasercutstudio:submit'] = 'Сдавать макет';
$string['lasercutstudio:view'] = 'Просматривать задание «LaserCut Studio»';
$string['lasercutstudio:viewallsubmissions'] = 'Просматривать все сданные макеты';
$string['modulename'] = 'LaserCut Studio';
$string['modulename_help'] = 'Задание «LaserCut Studio» встраивает в курс векторный редактор для лазерной резки: чертёж в миллиметрах 1:1, импорт и экспорт DXF/SVG, булевы операции, текст в кривых, раскладка деталей и проверка макета перед резкой. Студент рисует макет прямо в браузере и сдаёт его одной кнопкой, преподаватель скачивает файлы и ставит оценку.';
$string['modulenameplural'] = 'LaserCut Studio';
$string['nosubmission'] = 'Пока ничего не сдано';
$string['nosubmissions'] = 'Сданных макетов нет';
$string['objectcount'] = 'Объектов';
$string['openinnewtab'] = 'Открывать редактор в новой вкладке';
$string['openinnewtab_help'] = 'Студент открывает редактор в отдельной вкладке браузера, а не во встроенном фрейме. Удобно на небольших экранах.';
$string['pluginadministration'] = 'Управление LaserCut Studio';
$string['pluginname'] = 'LaserCut Studio';
$string['privacy:metadata:files'] = 'Файлы макета (.lcx, DXF, SVG), приложенные студентом к работе.';
$string['privacy:metadata:grades'] = 'Оценка, которую преподаватель поставил за сданный макет.';
$string['privacy:metadata:lasercutstudio_submissions'] = 'Сведения о сданных студентом макетах.';
$string['privacy:metadata:lasercutstudio_submissions:comment'] = 'Комментарий студента.';
$string['privacy:metadata:lasercutstudio_submissions:filename'] = 'Имя сданного файла.';
$string['privacy:metadata:lasercutstudio_submissions:grade'] = 'Оценка преподавателя.';
$string['privacy:metadata:lasercutstudio_submissions:objectcount'] = 'Количество объектов в сданном макете.';
$string['privacy:metadata:lasercutstudio_submissions:status'] = 'Статус работы (черновик, сдано, оценено).';
$string['privacy:metadata:lasercutstudio_submissions:timecreated'] = 'Время сдачи макета.';
$string['privacy:metadata:lasercutstudio_submissions:timemodified'] = 'Время изменения работы.';
$string['privacy:metadata:lasercutstudio_submissions:userid'] = 'Пользователь, сдавший макет.';
$string['projectempty'] = 'Редактор ещё не передал макет. Нарисуйте что-нибудь и нажмите «Сдать в Moodle» внутри редактора.';
$string['savedgrade'] = 'Оценка сохранена';
$string['status'] = 'Статус';
$string['status_draft'] = 'Черновик';
$string['status_graded'] = 'Оценено';
$string['status_submitted'] = 'Сдано';
$string['student'] = 'Студент';
$string['submitinstructions'] = 'Нарисуйте макет в миллиметрах 1:1, проверьте его панелью «Проверка», затем нажмите «Сдать в Moodle» внутри редактора и сохраните работу ниже.';
$string['submitsave'] = 'Сохранить работу';
$string['submitwork'] = 'Сдать макет';
$string['submissionreceived'] = 'Макет получен: объектов {$a->objects}, {$a->size} КБ. Нажмите «Сохранить работу», чтобы сдать его.';
$string['submissionstatus'] = 'Сдача работы';
$string['submittedat'] = 'Сдано';
$string['submittedthanks'] = 'Макет сдан';
$string['submissions'] = 'Сданные макеты';
$string['teacherview'] = 'Все сданные работы';
$string['timemodified'] = 'Обновлено';
$string['toobig'] = 'Макет слишком большой для отправки ({$a} КБ). Выгрузите его как .lcx и приложите файлом.';
$string['viewsubmissions'] = 'Сданные макеты';
$string['editornotready'] = 'Ожидание редактора…';
