# core/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('', views.list_projects, name='index'),
    path('projects/<slug:slug>/', views.detail_project, name='project_detail'),
    path('customprojects/<slug:slug>/', views.customproject_detail, name='customproject_detail'),
    path('curriculum', views.curriculum, name='curriculum'),
    path('cookie', views.cookie, name='cookie'),
]