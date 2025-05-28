from django.shortcuts import render
from django.shortcuts import render, get_object_or_404
import json
import os
from django.conf import settings
from django.template import TemplateDoesNotExist
from django.template.loader import get_template

def curriculum(request):
    return render(request, 'core/curriculum.html')

def list_projects(request):
    json_path = os.path.join(settings.BASE_DIR, 'core', 'data', 'customprojects.json')
    with open(json_path, 'r', encoding='utf-8') as file:
        customprojects = json.load(file)
    return render(request, 'core/index.html', {'customprojects': customprojects})

def customproject_detail(request, slug):
    json_path = os.path.join(settings.BASE_DIR, 'core', 'data', 'customprojects.json')
    with open(json_path, 'r', encoding='utf-8') as file:
        customprojects = json.load(file)
    customproject = next((p for p in customprojects if p['slug'] == slug), None)
    if not customproject:
        return render(request, 'core/404.html', status=404)
    try:
        template_name = f'core/{customproject["slug"]}.html'
        get_template(template_name)
    except TemplateDoesNotExist:
        return render(request, 'core/404.html', status=404)

    return render(request, template_name, {'customproject': customproject})

def cookie(request):
    return render(request, 'core/cookie.html')